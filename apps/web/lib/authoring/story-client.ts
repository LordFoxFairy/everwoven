import {createTRPCClient, httpLink, TRPCClientError} from '@trpc/client';
import type {AppRouter} from '../../server/api/root';
import {STORY_MUTATION_MAX_BYTES, type StoryProtocol, type DraftDTO, type DraftPage, type DraftCommandResult} from 'runtime/contracts/story-draft';
import {parseCreate, parseUpdate, parseLifecycle, parseGet, parseList} from 'runtime/contracts/story-draft-validation';
import {parseDraftDTO, parseDraftPage, parseDraftCommandResult} from 'runtime/contracts/story-draft-output';
import {storyErrorHTTPStatus, storyErrorTRPCCode, STORY_QUERY_MAX_BYTES, type StoryErrorCode} from '../../contracts/story-http';
import {StoryClientError, type StoryDraftClient} from './story-ports';
export {StoryClientError} from './story-ports';
export type {StoryDraftClient} from './story-ports';

function invalidResponse(status: number | null = 200) {return new StoryClientError('STORY_RESPONSE_INVALID', status, 'unknown');}
function responseData(result: DraftDTO | DraftPage | DraftCommandResult): DraftDTO | DraftPage {
  return 'data' in result ? result.data : result;
}
function input<T>(parse: (value: unknown) => T, value: unknown): T {
  try {return parse(value);} catch (error) {
    const code = error instanceof Error ? error.message : '';
    const status = storyErrorHTTPStatus(code);
    throw new StoryClientError(status ? code as StoryErrorCode : 'INVALID_STORY_COMMAND', status ?? 400, 'rejected');
  }
}
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try {return await work();} catch (error) {
    if (error instanceof StoryClientError) throw error;
    if (error instanceof TRPCClientError && error.cause instanceof StoryClientError) throw error.cause;
    // Fetch failures are classified at fetch below. Remaining link/JSON/DTO errors
    // never establish whether a mutation committed, and diagnostics stay private.
    throw invalidResponse();
  }
}
async function checkFailure(response: Response): Promise<never> {
  let value: unknown;
  const reader = response.body?.getReader();
  if (!reader) throw invalidResponse(response.status);
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value: chunk} = await reader.read(); if (done) break;
      bytes += chunk.byteLength;
      if (bytes > 8192) {void reader.cancel().catch(() => {}); throw invalidResponse(response.status);}
      chunks.push(chunk);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) {body.set(chunk, offset); offset += chunk.length;}
    value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));
  } catch {throw invalidResponse(response.status);} finally {reader.releaseLock();}
  const error = value && typeof value === 'object' && 'error' in value ? value.error : null;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && 'data' in error && error.data && typeof error.data === 'object') {
    const status = storyErrorHTTPStatus(error.message);
    if (status === response.status && 'httpStatus' in error.data && error.data.httpStatus === status && 'code' in error.data && error.data.code === storyErrorTRPCCode(status))
      throw new StoryClientError(error.message as StoryErrorCode, status, status < 500 ? 'rejected' : 'unknown');
  }
  throw invalidResponse(response.status);
}

/** Isolated nonbatch client. Session state is injected by the page, never mixed here. */
export function createStoryDraftClient(): StoryDraftClient {
  const rpc = createTRPCClient<AppRouter>({links: [httpLink({
    url: '/api/trpc', headers: {'x-everwoven-request': '1'},
    fetch: async (url, options) => {
      if (options?.method !== 'POST' && new TextEncoder().encode(String(url)).byteLength > STORY_QUERY_MAX_BYTES)
        throw new StoryClientError('INVALID_STORY_QUERY', 400, 'rejected');
      if (typeof options?.body === 'string' && new TextEncoder().encode(options.body).byteLength > STORY_MUTATION_MAX_BYTES)
        throw new StoryClientError('STORY_REQUEST_TOO_LARGE', 413, 'rejected');
      let response: Response;
      try {response = await fetch(url, {...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error'});}
      catch {throw new StoryClientError('STORY_NETWORK_ERROR', null, 'unknown');}
      if (response.status !== 200) return checkFailure(response);
      return response;
    },
  })]});
  function call<I extends StoryProtocol, O extends DraftDTO | DraftPage | DraftCommandResult>(
    parse: (value: unknown) => I, value: unknown, send: (parsed: I) => Promise<unknown>, output: (result: unknown) => O,
    action: 'create' | 'get' | 'list' | 'update' | 'delete' | 'restore',
  ): Promise<O> {
    return safe(async () => {
      const request = input(parse, value);
      const raw = await send(request);
      let result: O;
      try {result = output(raw);} catch {throw invalidResponse();}
      const data = responseData(result);
      if (data.protocolVersion !== request.protocolVersion || data.datasetId !== request.datasetId) throw invalidResponse();
      if ('id' in request && (!('id' in data) || data.id !== request.id)) throw invalidResponse();
      if ('data' in result) {
        const expected = action === 'create' ? 1 : 'expectedRevision' in request && typeof request.expectedRevision === 'number' ? request.expectedRevision + 1 : null;
        if (result.data.revision !== expected || (action === 'delete') !== (result.data.deletedAt !== null)) throw invalidResponse();
      }
      if (action === 'get' && 'includeDeleted' in request && !request.includeDeleted && 'deletedAt' in data && data.deletedAt !== null) throw invalidResponse();
      if ('items' in data && 'limit' in request && typeof request.limit === 'number' && data.items.length > request.limit) throw invalidResponse();
      return result;
    });
  }
  return {
    create: value => call(parseCreate, value, q => rpc.storyDrafts.create.mutate(q), parseDraftCommandResult, 'create'),
    get: value => call(parseGet, value, q => rpc.storyDrafts.get.query(q), parseDraftDTO, 'get'),
    list: value => call(parseList, value, q => rpc.storyDrafts.list.query(q), parseDraftPage, 'list'),
    update: value => call(parseUpdate, value, q => rpc.storyDrafts.update.mutate(q), parseDraftCommandResult, 'update'),
    delete: value => call(parseLifecycle, value, q => rpc.storyDrafts.delete.mutate(q), parseDraftCommandResult, 'delete'),
    restore: value => call(parseLifecycle, value, q => rpc.storyDrafts.restore.mutate(q), parseDraftCommandResult, 'restore'),
  };
}
