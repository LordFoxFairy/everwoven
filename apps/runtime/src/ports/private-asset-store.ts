import type {NormalizedImage} from './image-normalizer.js';

export type PrivateAssetMetadata = Omit<NormalizedImage, 'bytes'>;
export type VerifiedCandidate = {bytes: Buffer; metadata: PrivateAssetMetadata};
export type DurableCandidate = {kind: 'durable'; assetId: string; datasetId: string; metadata: PrivateAssetMetadata};
export type CandidateEvidence =
  | DurableCandidate
  | {kind: 'exists'; assetId: string; datasetId: string};
declare const deletingPermit: unique symbol;
/** Internal capability. Only the irreversible deleting transition may authorize its issuer. */
export type DeletionPermit = {readonly [deletingPermit]: true};
export type CleanupResult = {kind: 'removed' | 'absent'};
export type CleanupScope = Readonly<{ownerId: string; datasetId: string; assetId: string}>;
/** Required trusted adapter, no default. C1c must commit irreversible deleting in T1, then
 * in T2 acquire the SQLite writer lock, recheck scope/deleting and call work synchronously.
 * Hold the lock until real filesystem work finishes; no async WriteGate timer or lease release.
 * Release on success/error; never invoke work if authorization/lock acquisition fails.
 * C1b defines this contract only: SQLite SIGKILL/timeout evidence belongs to C1c. */
export interface CleanupCoordinator {
  runExclusive(scope: CleanupScope, work: () => CleanupResult): Promise<CleanupResult>;
}
export interface PrivateAssetStore {
  /** Durable filesystem evidence, NOT a ready asset, DB authorization, or a publication receipt. */
  writeCandidate(assetId: string, normalizedBytes: Uint8Array, expected: PrivateAssetMetadata, signal?: AbortSignal): Promise<CandidateEvidence>;
  /** Content verification only, not durability evidence. */
  verifyCandidate(assetId: string, expected: PrivateAssetMetadata): Promise<VerifiedCandidate>;
  /** Recovery for exists/full residues: same-handle decode + file sync + parent sync, no repair. */
  ensureDurableCandidate(assetId: string, expected: PrivateAssetMetadata): Promise<DurableCandidate>;
  removeDeletingCandidate(assetId: string, permit: DeletionPermit): Promise<CleanupResult>;
}
export type PrivateAssetErrorCode = 'PRIVATE_ASSET_INVALID_ARGUMENT' | 'PRIVATE_ASSET_BINDING_MISMATCH'
  | 'PRIVATE_ASSET_STORE_INVALIDATED' | 'PRIVATE_ASSET_IO' | 'PRIVATE_ASSET_ABORTED'
  | 'PRIVATE_ASSET_NOT_FOUND' | 'PRIVATE_ASSET_UNSAFE_FILE' | 'PRIVATE_ASSET_INVALID_PERMIT'
  | 'PRIVATE_ASSET_CONTENT_INVALID';
/** No paths, native decoder diagnostics, or original cause are exposed. */
export class PrivateAssetError extends Error {
  constructor(readonly code: PrivateAssetErrorCode) {super(code); this.name = 'PrivateAssetError';}
}
