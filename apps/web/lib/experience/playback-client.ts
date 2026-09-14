import {parseGetResponseDraft,parseSaveResponseDraft,parseResponseDraft,type GetResponseDraftInput,type SaveResponseDraftInput,type ResponseDraftDTO} from 'runtime/contracts/generation';
import {createTRPCClient, httpLink, TRPCClientError} from '@trpc/client';
import {parseGetPlay, parseCompletePlayback, parseGenerationQuote, parseAcceptGeneration, parseGetQuote, type GetPlayInput, type CompletePlaybackInput, type PlayDTO,
 type GenerationQuoteInput, type AcceptGenerationInput, type GetQuoteInput, type QuoteState} from 'runtime/contracts/generation';
import {parsePlayDTO, parsePlaybackResult, parseQuoteResult, parseAcceptResult, parseQuoteState, type PlaybackResult, type QuoteResult, type AcceptResult} from 'runtime/contracts/generation-output';
import type {AppRouter} from '../../server/api/root';
import {generationHTTPStatus, generationTRPCCode, GENERATION_QUERY_MAX_BYTES, GENERATION_COMMAND_MAX_BYTES, GENERATION_RESPONSE_MAX_BYTES, type GenerationErrorCode} from '../../contracts/generation-http';

export class PlaybackClientError extends Error {
  constructor(readonly code: GenerationErrorCode | 'PLAYBACK_NETWORK_ERROR' | 'PLAYBACK_RESPONSE_INVALID',
    readonly status: number | null, readonly outcome: 'rejected' | 'unknown') {super(code);}
}
export type PlaybackClient = {
  get(input: GetPlayInput): Promise<PlayDTO>;
  completePlayback(input: CompletePlaybackInput): Promise<PlaybackResult>;
};
export type GenerationClient = PlaybackClient & {
 getDraft(input:GetResponseDraftInput):Promise<ResponseDraftDTO>; saveDraft(input:SaveResponseDraftInput):Promise<ResponseDraftDTO>;
 quote(input: GenerationQuoteInput): Promise<QuoteResult>;
 accept(input: AcceptGenerationInput): Promise<AcceptResult>;
 getQuote(input: GetQuoteInput): Promise<QuoteState>;
};
const invalid = (status: number | null = 200) => new PlaybackClientError('PLAYBACK_RESPONSE_INVALID', status, 'unknown');
async function body(response: Response): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) throw invalid(response.status);
  const limit = response.status === 200 ? GENERATION_RESPONSE_MAX_BYTES : 8192;
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) {void reader.cancel().catch(() => {}); throw invalid(response.status);}
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {throw invalid(response.status);} finally {reader.releaseLock();}
}
function failure(raw: string, status: number, acceptance = false): never {
  let e;
  try {e = JSON.parse(raw)?.error;} catch {throw invalid(status);}
  if (typeof e?.message === 'string' && generationHTTPStatus(e.message) === status &&
    e.data?.httpStatus === status && e.data?.code === generationTRPCCode(status))
    throw new PlaybackClientError(e.message as GenerationErrorCode, status, status < 500 || acceptance && ['GENERATION_RUNTIME_UNAVAILABLE', 'GENERATION_PRICE_UNAVAILABLE', 'GENERATION_POLICY_UNAVAILABLE', 'GENERATION_PROFILE_UNAVAILABLE'].includes(e.message) ? 'rejected' : 'unknown');
  throw invalid(status);
}
/** No automatic mutation retries. A playback receipt is historical; callers GET the current state afterwards. */
export function createGenerationClient(): GenerationClient {
  const rpc = createTRPCClient<AppRouter>({links: [httpLink({url: '/api/trpc', headers: {'x-everwoven-request': '1'}, fetch: async (url, options) => {
    if (options?.method !== 'POST' && new TextEncoder().encode(String(url)).byteLength > GENERATION_QUERY_MAX_BYTES)
      throw new PlaybackClientError('INVALID_GENERATION_QUERY', 400, 'rejected');
    if (typeof options?.body === 'string' && new TextEncoder().encode(options.body).byteLength > GENERATION_COMMAND_MAX_BYTES)
      throw new PlaybackClientError('GENERATION_REQUEST_TOO_LARGE', 413, 'rejected');
    let response: Response;
    try {response = await fetch(url, {...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error'});}
    catch {throw new PlaybackClientError('PLAYBACK_NETWORK_ERROR', null, 'unknown');}
    const raw = await body(response);
    if (response.status !== 200) failure(raw, response.status, String(url).split('?')[0].endsWith('/generation.accept'));
    return new Response(raw, {status: 200, headers: {'content-type': 'application/json'}});
  }})]});
  async function call<I, O>(parse: (value: unknown) => I, input: I, send: (q: I) => Promise<unknown>, output: (raw: unknown, q: I) => O): Promise<O> {
    try {
      let q: I;
      try {q = parse(input);} catch (error) {
        const code = error instanceof Error ? error.message : '', status = generationHTTPStatus(code);
        throw new PlaybackClientError(status ? code as GenerationErrorCode : 'INVALID_GENERATION_COMMAND', status ?? 400, 'rejected');
      }
      const raw = await send(q);
      try {return output(raw, q);} catch {throw invalid();}
    } catch (error) {
      if (error instanceof PlaybackClientError) throw error;
      if (error instanceof TRPCClientError && error.cause instanceof PlaybackClientError) throw error.cause;
      throw invalid();
    }
  }
  function draftOutput(raw:unknown,q:GetResponseDraftInput):ResponseDraftDTO {
   const data=parseResponseDraft(raw);if(data.datasetId!==q.datasetId||data.experienceId!==q.experienceId||data.interactionEventId!==q.interactionEventId)throw invalid();return data;
  }
  return {
    getDraft: input=>call(parseGetResponseDraft,input,q=>rpc.generation.getDraft.query(q),draftOutput),
    saveDraft: input=>call(parseSaveResponseDraft,input,q=>rpc.generation.saveDraft.mutate(q),(raw,q)=>{
     const data=draftOutput(raw,q);if(data.text!==q.text||data.revision!==q.expectedDraftRevision+1)throw invalid();return data;
    }),
    quote: input => call(parseGenerationQuote, input, q => rpc.generation.quote.mutate(q), parseQuoteResult),
    accept: input => call(parseAcceptGeneration, input, q => rpc.generation.accept.mutate(q), parseAcceptResult),
    getQuote: input => call(parseGetQuote, input, q => rpc.generation.getQuote.query(q), (raw, q) => {
      const result = parseQuoteState(raw);
      if (result.quote.id !== q.quoteId || result.quote.datasetId !== q.datasetId || result.quote.experienceId !== q.experienceId) throw invalid();return result;
    }),
    get: input => call(parseGetPlay, input, q => rpc.generation.get.query(q), (raw, q) => {
      const data = parsePlayDTO(raw);
      if (data.datasetId !== q.datasetId || data.experienceId !== q.experienceId) throw invalid();
      return data;
    }),
    completePlayback: input => call(parseCompletePlayback, input, q => rpc.generation.completePlayback.mutate(q), parsePlaybackResult),
  };
}
export function createPlaybackClient(): PlaybackClient {return createGenerationClient();}
