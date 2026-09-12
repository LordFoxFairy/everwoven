/** Browser-safe wire constants and public error metadata. No runtime, server or storage imports. */
export const ASSET_DATASET_HEADER = 'x-everwoven-dataset-id';

const groups: ReadonlyArray<readonly [number, readonly string[]]> = [
  [401, ['LOCAL_SESSION_INVALID', 'UNAUTHORIZED']],
  [403, ['LOCAL_ORIGIN_DENIED', 'FORBIDDEN']],
  [400, ['INVALID_ASSET_COMMAND', 'INVALID_ASSET_QUERY', 'INVALID_IMAGE_INPUT', 'IMAGE_HASH_MISMATCH', 'IMAGE_SIZE_MISMATCH', 'INVALID_IMAGE_DATA', 'IMAGE_DIMENSIONS_INVALID', 'IMAGE_ANIMATED', 'IMAGE_BODY_INVALID_INPUT', 'IMAGE_BODY_ABORTED', 'IMAGE_BODY_SIZE_MISMATCH', 'IMAGE_BODY_HASH_MISMATCH', 'IMAGE_BODY_READ_FAILED', 'PRIVATE_ASSET_ABORTED', 'ASSET_CONTENT_LENGTH_INVALID']],
  [404, ['ASSET_NOT_FOUND', 'ASSET_UPLOAD_NOT_FOUND', 'PRIVATE_ASSET_NOT_FOUND']],
  [409, ['ASSET_UPLOAD_BUSY', 'ASSET_UPLOAD_EXPIRED', 'ASSET_STATE_INVALID', 'ASSET_LEASE_LOST', 'IDEMPOTENCY_CONFLICT', 'REVISION_EXHAUSTED', 'ASSET_IDENTITY_CONFLICT', 'ASSET_OUTPUT_MISMATCH', 'ASSET_CLEANUP_NOT_ALLOWED']],
  [412, ['DATASET_CHANGED']],
  [413, ['IMAGE_TOO_LARGE', 'IMAGE_OUTPUT_TOO_LARGE', 'IMAGE_BODY_TOO_LARGE']],
  [415, ['UNSUPPORTED_IMAGE_FORMAT', 'ASSET_MEDIA_TYPE_UNSUPPORTED']],
  [503, ['IMAGE_BODY_BUSY', 'IMAGE_BODY_TIMEOUT', 'IMAGE_DECODER_BUSY', 'IMAGE_PROCESSING_TIMEOUT', 'ASSET_UNAVAILABLE', 'OWNER_UNAVAILABLE']],
];
const statuses = new Map(groups.flatMap(([status, codes]) => codes.map(code => [code, status] as const)));
const trpcCodes = {400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 412: 'PRECONDITION_FAILED', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 503: 'SERVICE_UNAVAILABLE', 500: 'INTERNAL_SERVER_ERROR'} as const;
/** Exact public wire identifiers only. Host/private errors and display text stay at their boundaries. */
export function assetErrorHTTPStatus(identifier: string): number | undefined {return statuses.get(identifier);}
export function assetErrorTRPCCode(status: number): typeof trpcCodes[keyof typeof trpcCodes] | undefined {
  return Object.hasOwn(trpcCodes, status) ? trpcCodes[status as keyof typeof trpcCodes] : undefined;
}
