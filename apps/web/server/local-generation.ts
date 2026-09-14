import type {GetResponseDraftInput,SaveResponseDraftInput,ResponseDraftDTO,BeginPlaybackInput,PlaybackProgressInput,PlaybackSessionDTO} from 'runtime/contracts/generation';
import {TRPCError} from '@trpc/server';
import type {InternalOwnerContext} from 'runtime/contracts/story-draft';
import type {GetPlayInput, CompletePlaybackInput, PlayDTO, GenerationQuoteInput, AcceptGenerationInput, GetQuoteInput, QuoteState} from 'runtime/contracts/generation';
import type {QuoteResult, AcceptResult} from 'runtime/contracts/generation-output';
import type {PlaybackResult} from 'runtime/contracts/generation-output';
import {generationHTTPStatus, generationTRPCCode} from '../contracts/generation-http';
import {guardLocalRequest, localRuntimeConfig, sessionToken} from './local-boundary';

export type PlaybackService = {
 beginPlayback(input:BeginPlaybackInput):Promise<PlaybackSessionDTO>; reportPlayback(input:PlaybackProgressInput):Promise<PlaybackSessionDTO>;
  get(input: GetPlayInput): Promise<PlayDTO>;
  completePlayback(input: CompletePlaybackInput): Promise<PlaybackResult>;
};
export type WithPlayback = <T>(work: (service: PlaybackService, owner: InternalOwnerContext) => Promise<T>) => Promise<T>;
export type GenerationService = {getDraft(input:GetResponseDraftInput):Promise<ResponseDraftDTO>; saveDraft(input:SaveResponseDraftInput):Promise<ResponseDraftDTO>; quote(input: GenerationQuoteInput): Promise<QuoteResult>; accept(input: AcceptGenerationInput): Promise<AcceptResult>; getQuote(input: GetQuoteInput): Promise<QuoteState>};
export type WithGeneration = <T>(work: (service: GenerationService, owner: InternalOwnerContext) => Promise<T>) => Promise<T>;
const issuedErrors = new WeakSet<TRPCError>();
export function localGenerationError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    if (issuedErrors.has(error)) return error;
    if (error.cause instanceof TRPCError && issuedErrors.has(error.cause)) return error.cause;
  }
  const identifier = error instanceof Error && !(error instanceof TRPCError) ? error.message : '';
  const status = generationHTTPStatus(identifier);
  const result = new TRPCError({code: generationTRPCCode(status ?? 500), message: status ? identifier : 'GENERATION_INTERNAL_ERROR'});
  issuedErrors.add(result); return result;
}
export function localPlaybackAccess(request: Request, env: Record<string, string | undefined>): WithPlayback {
  return async work => {
    const config = localRuntimeConfig(env), token = sessionToken(request);
    if (!config || !token) throw localGenerationError(Error('LOCAL_SESSION_INVALID'));
    try {
      guardLocalRequest(request, config);
      const host = await import('runtime/host');
      return await host.withLocalGenerationPlayback(config.directory, config.environment, token, work);
    } catch (error) {throw localGenerationError(error);}
  };
}
export function localGenerationAccess(request: Request, env: Record<string, string | undefined>): WithGeneration {
 return async work => {
  const config = localRuntimeConfig(env), token = sessionToken(request);
  if (!config || !token) throw localGenerationError(Error('LOCAL_SESSION_INVALID'));
  try {guardLocalRequest(request, config);const host = await import('runtime/host');return await host.withLocalGeneration(config.directory, config.environment, token, work);}
  catch (error) {throw localGenerationError(error);}
 };
}
