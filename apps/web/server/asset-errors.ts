import {TRPCError} from '@trpc/server';
import {assetErrorHTTPStatus, assetErrorTRPCCode} from '../contracts/asset-http';

export function assetFailure(error: unknown): {status: number; message: string} {
  // External TRPCErrors do not define this boundary's public status or message.
  const code = error instanceof Error && !(error instanceof TRPCError) ? error.message : '';
  const status = assetErrorHTTPStatus(code);
  return status ? {status, message: code} : {status: 500, message: '服务暂不可用'};
}
const issued = new WeakSet<TRPCError>();
export function assetTRPCError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    if (issued.has(error)) return error;
    // tRPC input/output middleware wraps parser errors. Only our own issued cause is trusted.
    if (error.cause instanceof TRPCError && issued.has(error.cause)) return error.cause;
  }
  const failure = assetFailure(error);
  const result = new TRPCError({code: assetErrorTRPCCode(failure.status)!, message: failure.message});
  issued.add(result); return result;
}
export const assetSecurityHeaders = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
export function assetJSON(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return Response.json(body, {status, headers: {...assetSecurityHeaders, ...extra}});
}
export function assetErrorResponse(error: unknown): Response {
  const failure = assetFailure(error); return assetJSON({error: failure.message}, failure.status);
}
