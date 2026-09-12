import {isAsyncFunction} from 'node:util/types';
import type {PrismaClient} from '../../generated/prisma/client.js';
import type {InternalOwnerContext} from '../../contracts/story-draft.js';
import {isBusinessId} from '../../contracts/primitives.js';
import type {CleanupCoordinator, CleanupResult, CleanupScope} from '../../ports/private-asset-store.js';
import {AssetCleanupError} from '../../ports/asset-cleanup-error.js';
import {withOwnerWrite} from './write-gate.js';

/** T2 only. T1's irreversible deleting transition MUST already be committed independently.
 * This is SQLite database-wide writer exclusion, NOT an owner/asset row lock.
 * The approved better-sqlite3 adapter executes on this Node event loop; after the last DB
 * validation, the FileStore callback runs synchronously without an await or timer race.
 * The unchanged 3s transaction timeout is NOT cancellation of filesystem work. A slow sync
 * callback blocks that event loop until it ends; even if T2 later rolls back, T1 stays deleting.
 * No images, buffers, network, upload work, or asynchronous filesystem callbacks belong here. */
export function createAssetCleanupCoordinator(db: PrismaClient, owner: InternalOwnerContext): CleanupCoordinator {
  const ownerId = owner?.ownerId, datasetId = owner?.datasetId;
  if (!isBusinessId(ownerId) || !isBusinessId(datasetId)) throw new AssetCleanupError('ASSET_CLEANUP_INVALID_SCOPE');
  function validateScope(scope: CleanupScope): string {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope) || Object.keys(scope).length !== 3 ||
        !['ownerId', 'datasetId', 'assetId'].every(key => Object.hasOwn(scope, key)) ||
        scope.ownerId !== ownerId || scope.datasetId !== datasetId || !isBusinessId(scope.assetId)) {
      throw new AssetCleanupError('ASSET_CLEANUP_INVALID_SCOPE');
    }
    return scope.assetId;
  }
  return {runExclusive: async (scope, work) => {
    try {
      // Reject scope before any Store/transaction access; binding is trusted, immutable context.
      const assetId = validateScope(scope);
      if (typeof work !== 'function' || isAsyncFunction(work)) throw new AssetCleanupError('ASSET_CLEANUP_INVALID_CALLBACK');
      return await withOwnerWrite(db, ownerId, async tx => {
        // Query globally by asset identity: cross-owner duplicates are ambiguous too.
        const intents = await tx.assetUpload.findMany({where: {assetId}, take: 2, select: {id: true, ownerId: true, status: true}});
        if (intents.length !== 1 || intents[0]!.ownerId !== ownerId || intents[0]!.status !== 'deleting') {
          throw new AssetCleanupError('ASSET_CLEANUP_NOT_ALLOWED');
        }
        // Any historical Asset blocks cleanup, regardless of owner, availability or soft deletion.
        // Also fail closed if a different asset identity aliases this candidate's fixed path.
        const asset = await tx.asset.findFirst({where: {OR: [{id: assetId}, {storageKey: `assets/${datasetId}/${assetId}.webp`}]}, select: {id: true}});
        if (asset) throw new AssetCleanupError('ASSET_CLEANUP_NOT_ALLOWED');
        const result: CleanupResult = work(); // No await between completed validation and sync FS.
        if (!result || typeof result !== 'object' || Object.getPrototypeOf(result) !== Object.prototype ||
            Object.keys(result).length !== 1 || !Object.hasOwn(result, 'kind') || !['removed', 'absent'].includes(result.kind)) {
          // Reject a hidden Promise/thenable, observing rejection but never awaiting or cancelling it.
          void Promise.resolve(result).catch(() => {});
          throw new AssetCleanupError('ASSET_CLEANUP_INVALID_CALLBACK');
        }
        return result; // Preserve the FileStore's exact result object, without serialization or cloning.
      });
    } catch (error) {
      if (error instanceof AssetCleanupError) throw error;
      if (error instanceof Error && error.message === 'OWNER_UNAVAILABLE') throw new AssetCleanupError('ASSET_CLEANUP_NOT_ALLOWED');
      throw new AssetCleanupError('ASSET_CLEANUP_FAILED');
    }
  }};
}
