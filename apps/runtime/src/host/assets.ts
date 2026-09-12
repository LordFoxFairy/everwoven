import type {PrismaClient} from '../generated/prisma/client.js';
import type {InternalOwnerContext} from '../contracts/story-draft.js';
import type {ValidatedHost} from './storage.js';
import {createAssetService} from '../composition/asset-service.js';
import {createImageNormalizer} from '../infrastructure/media/sharp-image-normalizer.js';
import {createImageBodyReceiver} from '../infrastructure/media/image-body-receiver.js';
import {createPrivateAssetStore} from '../infrastructure/media/private-asset-store.js';
import {createAssetCleanupCoordinator} from '../infrastructure/db/prisma-asset-cleanup-coordinator.js';

// Enumerated identifiers only. Unknown driver, callback and Host diagnostics are
// mapped by the shared outer boundary, never matched by prefix or returned with causes.
export const assetErrors: ReadonlySet<string> = new Set([
  'DATASET_CHANGED', 'UNAUTHORIZED', 'FORBIDDEN', 'OWNER_UNAVAILABLE',
  'INVALID_ASSET_COMMAND', 'INVALID_ASSET_QUERY', 'STORED_ASSET_INVALID',
  'ASSET_NOT_FOUND', 'ASSET_UPLOAD_NOT_FOUND', 'ASSET_IDENTITY_CONFLICT',
  'ASSET_UPLOAD_BUSY', 'ASSET_UPLOAD_EXPIRED', 'ASSET_STATE_INVALID', 'ASSET_LEASE_LOST',
  'ASSET_OUTPUT_MISMATCH', 'ASSET_EVIDENCE_INVALID', 'ASSET_CLEANUP_NOT_ALLOWED', 'ASSET_UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT', 'COMMAND_RECEIPT_INVALID', 'REVISION_EXHAUSTED',
  'PRIVATE_ASSET_INVALID_ARGUMENT', 'PRIVATE_ASSET_BINDING_MISMATCH', 'PRIVATE_ASSET_STORE_INVALIDATED',
  'PRIVATE_ASSET_IO', 'PRIVATE_ASSET_ABORTED', 'PRIVATE_ASSET_NOT_FOUND', 'PRIVATE_ASSET_UNSAFE_FILE',
  'PRIVATE_ASSET_INVALID_PERMIT', 'PRIVATE_ASSET_CONTENT_INVALID',
  'INVALID_IMAGE_INPUT', 'IMAGE_TOO_LARGE', 'IMAGE_HASH_MISMATCH', 'IMAGE_SIZE_MISMATCH',
  'UNSUPPORTED_IMAGE_FORMAT', 'INVALID_IMAGE_DATA', 'IMAGE_DIMENSIONS_INVALID', 'IMAGE_ANIMATED',
  'IMAGE_DECODER_BUSY', 'IMAGE_PROCESSING_TIMEOUT', 'IMAGE_OUTPUT_TOO_LARGE',
  'IMAGE_BODY_INVALID_INPUT', 'IMAGE_BODY_BUSY', 'IMAGE_BODY_ABORTED', 'IMAGE_BODY_TIMEOUT',
  'IMAGE_BODY_TOO_LARGE', 'IMAGE_BODY_SIZE_MISMATCH', 'IMAGE_BODY_HASH_MISMATCH', 'IMAGE_BODY_READ_FAILED',
  'ASSET_CLEANUP_INVALID_SCOPE', 'ASSET_CLEANUP_FAILED', 'ASSET_CLEANUP_INVALID_CALLBACK',
]);

/** Constructor has no image-directory I/O. Cleanup is an explicit service operation,
 * not startup scanning, maintenance scheduling or automatic orphan reclamation. */
export function bindAssets(db: PrismaClient, owner: InternalOwnerContext, host: ValidatedHost, revalidate: () => Promise<void>) {
  const coordinator = createAssetCleanupCoordinator(db, owner);
  return createAssetService(db, {
    owner, revalidate, receiver: createImageBodyReceiver(), normalizer: createImageNormalizer(),
    openFiles: async () => {
      await revalidate();
      return createPrivateAssetStore(host, owner, coordinator);
    },
  });
}
