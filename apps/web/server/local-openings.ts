import {TRPCError} from '@trpc/server';
import type {InternalOwnerContext} from 'runtime/contracts/story-draft';
import type {CreateExperience, GetPreparingExperience, ExperienceOpeningResult, ExperienceOpeningDTO} from 'runtime/contracts/experience-opening';
import type {BindingDirectory} from 'runtime/contracts/video-binding-registry';
import {openingHTTPStatus, openingTRPCCode} from '../contracts/experience-http';
import {guardLocalRequest, localRuntimeConfig, sessionToken} from './local-boundary';

export type OpeningService = {
  create(owner: InternalOwnerContext, input: CreateExperience): Promise<ExperienceOpeningResult>;
  getPreparing(owner: InternalOwnerContext, input: GetPreparingExperience): Promise<ExperienceOpeningDTO>;
  bindings(): BindingDirectory;
};
export type WithOpenings = <T>(work: (service: OpeningService, owner: InternalOwnerContext) => Promise<T>) => Promise<T>;
const issuedErrors = new WeakSet<TRPCError>();
export function localOpeningError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    if (issuedErrors.has(error)) return error;
    if (error.cause instanceof TRPCError && issuedErrors.has(error.cause)) return error.cause;
  }
  const identifier = error instanceof Error && !(error instanceof TRPCError) ? error.message : '';
  const status = openingHTTPStatus(identifier);
  const result = new TRPCError({code: openingTRPCCode(status ?? 500), message: status ? identifier : 'EXPERIENCE_INTERNAL_ERROR'});
  issuedErrors.add(result); return result;
}
export function localOpeningAccess(request: Request, env: Record<string, string | undefined>): WithOpenings {
  return async work => {
    const config = localRuntimeConfig(env), token = sessionToken(request);
    if (!config || !token) throw localOpeningError(Error('LOCAL_SESSION_INVALID'));
    try {
      guardLocalRequest(request, config);
      const host = await import('runtime/host');
      return await host.withLocalExperienceOpenings(config.directory, config.environment, token, work);
    } catch (error) {throw localOpeningError(error);}
  };
}
