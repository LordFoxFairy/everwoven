import {constants, openSync, lstatSync, fstatSync, closeSync, unlinkSync, type Stats} from 'node:fs';
import {lstat, open, type FileHandle} from 'node:fs/promises';
import {isAsyncFunction} from 'node:util/types';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {ValidatedHost} from '../../host/storage.js';
import {IMAGE_LIMITS} from '../../contracts/asset.js';
import {ImageNormalizationError} from '../../ports/image-normalizer.js';
import {PrivateAssetError, type PrivateAssetStore, type PrivateAssetMetadata, type VerifiedCandidate, type CleanupCoordinator, type CleanupResult} from '../../ports/private-asset-store.js';
import {assertDeletionPermit, isAssetId, runCleanupCheckpoint, type CleanupCheckpoint} from './private-asset-deletion.js';
import {hasCode, PrivateAssetDirectories, sameInode} from './private-asset-directories.js';
import {parseCandidateMetadata, verifyNormalizedImage} from './private-asset-verifier.js';

export type PrivateAssetPhase = 'after-directory-create' | 'before-directory-sync' | 'after-directory-sync'
  | 'before-create' | 'after-create' | 'before-file-sync' | 'after-read';
/** Internal fault injection only. It cannot replace stat/open/read/security checks or skip sync.
 * Even an injected successful short write must pass actual descriptor readback and full decode. */
export type PrivateAssetFaults = {
  cleanupCheckpoint?: CleanupCheckpoint;
  checkpoint?: (phase: PrivateAssetPhase, context: {assetId?: string; directory?: 'host' | 'assets' | 'dataset'}) => Promise<void>;
  write?: (handle: FileHandle, bytes: Buffer, offset: number, length: number, position: number) => Promise<number>;
};
function argumentId(value: unknown): asserts value is string {
  if (!isAssetId(value)) throw new PrivateAssetError('PRIVATE_ASSET_INVALID_ARGUMENT');
}
function expectedMetadata(value: unknown): PrivateAssetMetadata {
  try {return parseCandidateMetadata(value);} catch {throw new PrivateAssetError('PRIVATE_ASSET_INVALID_ARGUMENT');}
}
function abort(signal?: AbortSignal): void {if (signal?.aborted) throw new PrivateAssetError('PRIVATE_ASSET_ABORTED');}
function checkedFile(stat: Stats): void {
  if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1) {
    throw new PrivateAssetError('PRIVATE_ASSET_UNSAFE_FILE');
  }
}
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try {return await work();} catch (error) {
    if (error instanceof PrivateAssetError) throw error;
    if (error instanceof ImageNormalizationError) {
      if (error.code === 'IMAGE_DECODER_BUSY' || error.code === 'IMAGE_PROCESSING_TIMEOUT') throw error;
      throw new PrivateAssetError('PRIVATE_ASSET_CONTENT_INVALID');
    }
    throw new PrivateAssetError('PRIVATE_ASSET_IO');
  }
}
async function existing(path: string, writable = false): Promise<FileHandle> {
  let before: Stats;
  try {before = await lstat(path);} catch (error) {if (hasCode(error, 'ENOENT')) throw new PrivateAssetError('PRIVATE_ASSET_NOT_FOUND'); throw error;}
  checkedFile(before);
  const handle = await open(path, (writable ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {const now = await handle.stat(); checkedFile(now); if (!sameInode(before, now)) throw new PrivateAssetError('PRIVATE_ASSET_UNSAFE_FILE'); return handle;}
  catch (error) {await handle.close(); throw error;}
}
/** Read only through this descriptor, never re-open the filename after verification. */
async function readback(handle: FileHandle, expected: PrivateAssetMetadata): Promise<VerifiedCandidate> {
  const before = await handle.stat(); checkedFile(before);
  if (before.size > IMAGE_LIMITS.outputBytes || String(before.size) !== expected.byteSize) throw new PrivateAssetError('PRIVATE_ASSET_CONTENT_INVALID');
  const bytes = Buffer.alloc(before.size + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  const after = await handle.stat(); checkedFile(after);
  if (!sameInode(before, after) || before.size !== after.size || offset !== before.size) throw new PrivateAssetError('PRIVATE_ASSET_CONTENT_INVALID');
  return verifyNormalizedImage(bytes.subarray(0, offset), expected);
}
/** Trusted host + binding only. No caller-controlled namespace, paths, or original filenames.
 * Namespace rule: IDs never reused; writers never unlink; deleting forbids new takeovers.
 * Old writers can still finish/create late, so C1c must retain and re-clean terminal records. */
export async function createPrivateAssetStore(host: ValidatedHost, binding: {ownerId: string; datasetId: string}, coordinator: CleanupCoordinator, faults: PrivateAssetFaults = {}): Promise<PrivateAssetStore> {
  return safe(async () => {
    const ownerId = binding?.ownerId, datasetId = binding?.datasetId;
    if (!isAssetId(ownerId) || !isAssetId(datasetId) || ownerId !== host.manifest.ownerId || datasetId !== host.manifest.datasetId) {
      throw new PrivateAssetError('PRIVATE_ASSET_BINDING_MISMATCH');
    }
    if (!coordinator || typeof coordinator.runExclusive !== 'function' ||
        (faults.cleanupCheckpoint && (typeof faults.cleanupCheckpoint !== 'function' || isAsyncFunction(faults.cleanupCheckpoint)))) {
      throw new PrivateAssetError('PRIVATE_ASSET_INVALID_ARGUMENT');
    }
    const dirs = await PrivateAssetDirectories.create(host, datasetId, faults);
    const pathFor = (assetId: string) => join(dirs.datasetPath, `${assetId}.webp`);
    return {
      writeCandidate: (assetId, input, value, signal) => safe(async () => {
        argumentId(assetId); const expected = expectedMetadata(value);
        if (!(input instanceof Uint8Array) || input.byteLength > IMAGE_LIMITS.outputBytes) throw new PrivateAssetError('PRIVATE_ASSET_INVALID_ARGUMENT');
        const bytes = Buffer.from(input);
        if (String(bytes.length) !== expected.byteSize || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new PrivateAssetError('PRIVATE_ASSET_CONTENT_INVALID');
        abort(signal); await dirs.recheck();
        await faults.checkpoint?.('before-create', {assetId}); abort(signal); await dirs.recheck();
        let handle: FileHandle;
        try {handle = await open(pathFor(assetId), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);}
        catch (error) {if (hasCode(error, 'EEXIST')) {await dirs.recheck(); return {kind: 'exists', assetId, datasetId};} throw error;}
        try {
          checkedFile(await handle.stat());
          await faults.checkpoint?.('after-create', {assetId}); abort(signal); await dirs.recheck(); checkedFile(await handle.stat());
          for (let offset = 0; offset < bytes.length;) {
            abort(signal);
            const length = Math.min(64 * 1024, bytes.length - offset);
            const count = faults.write ? await faults.write(handle, bytes, offset, length, offset) : (await handle.write(bytes, offset, length, offset)).bytesWritten;
            if (!Number.isInteger(count) || count <= 0 || count > length) throw new PrivateAssetError('PRIVATE_ASSET_IO');
            offset += count;
          }
          abort(signal); await dirs.recheck(); checkedFile(await handle.stat());
          await faults.checkpoint?.('before-file-sync', {assetId}); abort(signal); await handle.sync();
          const verified = await readback(handle, expected);
          await faults.checkpoint?.('after-read', {assetId}); abort(signal);
          await dirs.sync('dataset', assetId); abort(signal); checkedFile(await handle.stat());
          return {kind: 'durable', assetId, datasetId, metadata: verified.metadata};
        } finally {await handle.close();} // Failure leaves partial candidates; only deleting cleanup removes them.
      }),
      verifyCandidate: (assetId, value) => safe(async () => {
        argumentId(assetId); const expected = expectedMetadata(value); await dirs.recheck();
        const handle = await existing(pathFor(assetId));
        try {
          const verified = await readback(handle, expected);
          await faults.checkpoint?.('after-read', {assetId}); await dirs.recheck(); checkedFile(await handle.stat());
          return verified;
        } finally {await handle.close();}
      }),
      ensureDurableCandidate: (assetId, value) => safe(async () => {
        argumentId(assetId); const expected = expectedMetadata(value); await dirs.recheck();
        const handle = await existing(pathFor(assetId), true);
        try {
          const verified = await readback(handle, expected);
          await faults.checkpoint?.('after-read', {assetId}); await dirs.recheck(); checkedFile(await handle.stat());
          await faults.checkpoint?.('before-file-sync', {assetId}); await handle.sync();
          await dirs.sync('dataset', assetId); checkedFile(await handle.stat());
          return {kind: 'durable', assetId, datasetId, metadata: verified.metadata};
        } finally {await handle.close();}
      }),
      removeDeletingCandidate: (assetId, permit) => safe(async () => {
        argumentId(assetId); assertDeletionPermit(permit, {ownerId, datasetId, assetId});
        let executed = false, result: CleanupResult | undefined;
        const response = await coordinator.runExclusive(Object.freeze({ownerId, datasetId, assetId}), () => {
          if (executed) throw new PrivateAssetError('PRIVATE_ASSET_INVALID_ARGUMENT');
          executed = true;
          // No await, pixel decode, buffers, uploads, or async fault hooks in this critical section.
          dirs.recheckSync();
          const path = pathFor(assetId);
          let before: Stats;
          try {before = lstatSync(path);} catch (error) {
            if (hasCode(error, 'ENOENT')) {dirs.syncCleanup(assetId, faults.cleanupCheckpoint); return result = {kind: 'absent'};}
            throw error;
          }
          checkedFile(before);
          const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const opened = fstatSync(fd); checkedFile(opened);
            if (!sameInode(before, opened)) throw new PrivateAssetError('PRIVATE_ASSET_UNSAFE_FILE');
            runCleanupCheckpoint(faults.cleanupCheckpoint, 'before-unlink', assetId); dirs.recheckSync();
            const held = fstatSync(fd), current = lstatSync(path); checkedFile(held); checkedFile(current);
            if (!sameInode(held, current)) throw new PrivateAssetError('PRIVATE_ASSET_UNSAFE_FILE');
            // Not atomic conditional-inode unlink: cooperative namespace rules still apply.
            // The required coordinator retains its actual writer lock until this sync work ends.
            unlinkSync(path);
            dirs.syncCleanup(assetId, faults.cleanupCheckpoint);
            return result = {kind: 'removed'};
          } finally {closeSync(fd);}
        });
        if (!result || response !== result) throw new PrivateAssetError('PRIVATE_ASSET_IO');
        return result;
      })
    } satisfies PrivateAssetStore;
  });
}
