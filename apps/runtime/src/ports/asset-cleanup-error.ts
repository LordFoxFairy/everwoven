export type AssetCleanupErrorCode = 'ASSET_CLEANUP_INVALID_SCOPE' | 'ASSET_CLEANUP_NOT_ALLOWED' | 'ASSET_CLEANUP_FAILED' | 'ASSET_CLEANUP_INVALID_CALLBACK';
/** Fixed internal errors only: never expose SQL, driver messages, filesystem paths or causes. */
export class AssetCleanupError extends Error {
  constructor(readonly code: AssetCleanupErrorCode) {super(code); this.name = 'AssetCleanupError';}
}
