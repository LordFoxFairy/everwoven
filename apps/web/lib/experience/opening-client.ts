import {createTRPCClient, httpLink, TRPCClientError} from '@trpc/client';
import type {AppRouter} from '../../server/api/root';
import {parseCreateExperience, parseGetPreparingExperience} from 'runtime/contracts/experience-opening-validation';
import {parseBindingDirectory, parseExperienceOpeningDTO, parseExperienceOpeningResult} from 'runtime/contracts/experience-opening-output';
import {fields, parseProtocol} from 'runtime/contracts/story-draft-validation';
import type {StoryProtocol} from 'runtime/contracts/story-draft';
import type {ExperienceOpeningDTO, ExperienceOpeningResult} from 'runtime/contracts/experience-opening';
import type {BindingDirectory} from 'runtime/contracts/video-binding-registry';
import {OPENING_COMMAND_MAX_BYTES, OPENING_QUERY_MAX_BYTES, OPENING_RESPONSE_MAX_BYTES, openingHTTPStatus, openingTRPCCode, type OpeningErrorCode} from '../../contracts/experience-http';
import {OpeningClientError, type OpeningClient} from './opening-ports';

const invalid = (status: number | null = 200) => new OpeningClientError('OPENING_RESPONSE_INVALID', status, 'unknown');
async function boundedBody(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) throw invalid(response.status);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) {void reader.cancel().catch(() => {}); throw invalid(response.status);}
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {throw invalid(response.status);} finally {reader.releaseLock();}
}
function failure(body: string, status: number): never {
  let value: unknown; try {value = JSON.parse(body);} catch {throw invalid(status);}
  if (value && typeof value === 'object' && 'error' in value) {
    const e = value.error;
    if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && 'data' in e && e.data && typeof e.data === 'object' &&
      openingHTTPStatus(e.message) === status && 'httpStatus' in e.data && e.data.httpStatus === status && 'code' in e.data && e.data.code === openingTRPCCode(status))
      throw new OpeningClientError(e.message as OpeningErrorCode, status, status < 500 ? 'rejected' : 'unknown');
  }
  throw invalid(status);
}
function directoryQuery(value: unknown): StoryProtocol {
  const protocol = parseProtocol(value);
  try {fields(value, ['protocolVersion', 'datasetId']); return protocol;} catch {throw Error('INVALID_EXPERIENCE_QUERY');}
}
function responseProtocol(result: ExperienceOpeningDTO | ExperienceOpeningResult | BindingDirectory): StoryProtocol {
  return 'data' in result ? result.data : result;
}
/** Browser transport only. No business retries, credentials lookup, browser persistence or provider calls. */
export function createOpeningClient(): OpeningClient {
  const rpc = createTRPCClient<AppRouter>({links: [httpLink({url: '/api/trpc', headers: {'x-everwoven-request': '1'}, fetch: async (url, options) => {
    if (options?.method !== 'POST' && new TextEncoder().encode(String(url)).byteLength > OPENING_QUERY_MAX_BYTES)
      throw new OpeningClientError('INVALID_EXPERIENCE_QUERY', 400, 'rejected');
    if (typeof options?.body === 'string' && new TextEncoder().encode(options.body).byteLength > OPENING_COMMAND_MAX_BYTES)
      throw new OpeningClientError('EXPERIENCE_REQUEST_TOO_LARGE', 413, 'rejected');
    let response: Response;
    try {response = await fetch(url, {...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error'});}
    catch {throw new OpeningClientError('OPENING_NETWORK_ERROR', null, 'unknown');}
    const body = await boundedBody(response, response.status === 200 ? OPENING_RESPONSE_MAX_BYTES : 8192);
    if (response.status !== 200) failure(body, response.status);
    return new Response(body, {status: 200, headers: {'content-type': 'application/json'}});
  }})]});
  async function call<I extends StoryProtocol, O extends ExperienceOpeningDTO | ExperienceOpeningResult | BindingDirectory>(
    parser: (v: unknown) => I, input: unknown, send: (q: I) => Promise<unknown>, output: (v: unknown, q: I) => O,
  ): Promise<O> {
    try {
      let q: I;
      try {q = parser(input);} catch (error) {
        const code = error instanceof Error ? error.message : '', status = openingHTTPStatus(code);
        throw new OpeningClientError(status ? code as OpeningErrorCode : 'INVALID_EXPERIENCE_COMMAND', status ?? 400, 'rejected');
      }
      const raw = await send(q); let result: O;
      try {result = output(raw, q);} catch {throw invalid();}
      const data = responseProtocol(result);
      if (data.datasetId !== q.datasetId || data.protocolVersion !== q.protocolVersion) throw invalid();
      return result;
    } catch (error) {
      if (error instanceof OpeningClientError) throw error;
      if (error instanceof TRPCClientError && error.cause instanceof OpeningClientError) throw error.cause;
      throw invalid();
    }
  }
  return {
    bindings: q => call(directoryQuery, q, input => rpc.openings.bindings.query(input), parseBindingDirectory),
    create: q => call(parseCreateExperience, q, input => rpc.openings.create.mutate(input), (raw, input) => {
      const result = parseExperienceOpeningResult(raw), d = result.data;
      if (d.story.storyDraftId !== input.storyDraftId || d.story.sourceRevision !== input.expectedStoryRevision ||
        d.binding.bindingKey !== input.bindingKey || d.binding.versionNo !== input.expectedBindingVersion ||
        d.budget.currency !== input.budget.currency || d.budget.limitMicros !== input.budget.limitMicros) throw invalid();
      return result;
    }),
    getPreparing: q => call(parseGetPreparingExperience, q, input => rpc.openings.getPreparing.query(input), (raw, input) => {
      const dto = parseExperienceOpeningDTO(raw); if (dto.id !== input.id) throw invalid(); return dto;
    }),
  };
}
