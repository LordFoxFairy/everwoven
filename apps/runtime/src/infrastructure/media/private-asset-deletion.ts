import {PrivateAssetError, type DeletionPermit} from '../../ports/private-asset-store.js';

type DeletingIdentity = {ownerId: string; datasetId: string; assetId: string; status: 'deleting'};
const permits = new WeakMap<object, Readonly<DeletingIdentity>>();
export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
/** INTERNAL ONLY: C1c must first win the irreversible deleting CAS. This issuer does not
 * query a DB or prove authorization; never wire it to HTTP input. Completed assets get no permit.
 * Terminal records retain the capability for repeated cleanup of late-writer residues. */
export function issueDeletionPermitForDeleting(identity: DeletingIdentity): DeletionPermit {
  if (!identity || identity.status !== 'deleting' || ![identity.ownerId, identity.datasetId, identity.assetId].every(isAssetId)) {
    throw new PrivateAssetError('PRIVATE_ASSET_INVALID_PERMIT');
  }
  const permit = Object.freeze({}) as DeletionPermit;
  permits.set(permit, Object.freeze({...identity}));
  return permit;
}
export function assertDeletionPermit(permit: DeletionPermit, expected: Omit<DeletingIdentity, 'status'>): void {
  const identity = permit && typeof permit === 'object' ? permits.get(permit) : undefined;
  if (!identity || identity.ownerId !== expected.ownerId || identity.datasetId !== expected.datasetId || identity.assetId !== expected.assetId) {
    throw new PrivateAssetError('PRIVATE_ASSET_INVALID_PERMIT');
  }
}
export type CleanupPhase = 'before-unlink' | 'before-directory-sync' | 'after-directory-sync';
/** undefined (not void) intentionally rejects async functions at the type boundary. */
export type CleanupCheckpoint = (phase: CleanupPhase, context: {assetId: string}) => undefined;
export function runCleanupCheckpoint(hook: CleanupCheckpoint | undefined, phase: CleanupPhase, assetId: string): void {
  if (!hook) return;
  const result = hook(phase, {assetId});
  if (result !== undefined) {
    // A wrapper can hide a Promise/thenable from isAsyncFunction. Observe its rejection
    // without awaiting it or claiming cancellation; cleanup still fails synchronously.
    void Promise.resolve(result).catch(() => {});
    throw new PrivateAssetError('PRIVATE_ASSET_INVALID_ARGUMENT');
  }
}
