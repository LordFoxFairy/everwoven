/** Pure story wire protocol. Do not extend character/asset transport policies here. */
export const STORY_QUERY_MAX_BYTES = 16 * 1024;
export const STORY_HTTP_STATUS = Object.freeze({
  INVALID_STORY_COMMAND: 400, INVALID_STORY_QUERY: 400, INVALID_CURSOR: 400,
  LOCAL_SESSION_INVALID: 401, LOCAL_ORIGIN_DENIED: 403,
  STORY_NOT_FOUND: 404, CHARACTER_NOT_FOUND: 404, ASSET_NOT_FOUND: 404,
  REVISION_CONFLICT: 409, TEMPLATE_REVISION_CONFLICT: 409, STORY_NOT_DELETED: 409,
  REVISION_EXHAUSTED: 409, IDEMPOTENCY_CONFLICT: 409, STORY_ASSET_NOT_READY: 409,
  DATASET_CHANGED: 412, CLIENT_RELOAD_REQUIRED: 412, STORY_REQUEST_TOO_LARGE: 413,
  STORY_INTERNAL_ERROR: 500,
} as const);
export type StoryErrorCode = keyof typeof STORY_HTTP_STATUS;
export function storyErrorHTTPStatus(code: string): number | undefined {
  return Object.hasOwn(STORY_HTTP_STATUS, code) ? STORY_HTTP_STATUS[code as StoryErrorCode] : undefined;
}
const trpcCodes = {400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 412: 'PRECONDITION_FAILED', 413: 'PAYLOAD_TOO_LARGE', 500: 'INTERNAL_SERVER_ERROR'} as const;
export function storyErrorTRPCCode(status: number): typeof trpcCodes[keyof typeof trpcCodes] {
  return trpcCodes[status as keyof typeof trpcCodes] ?? 'INTERNAL_SERVER_ERROR';
}
