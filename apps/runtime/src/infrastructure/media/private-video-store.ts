import {constants, type Stats} from 'node:fs';
import {open, lstat, rename, type FileHandle} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {v7} from 'uuid';
import type {ValidatedHost} from '../../host/storage.js';
import {writeExclusive} from '../../host/storage.js';
import {parseId, fields} from '../../contracts/story-draft-validation.js';
import {parsePrivateVideoMetadata} from '../../contracts/private-video.js';
import {parseVideoJobSnapshot} from '../../contracts/video-job-output.js';
import {VIDEO_FILE_LIMIT, type PrivateVideoStore, type PrivateVideoMetadata, type VideoDownloadSource, type VideoProbe} from '../../ports/private-video.js';
import {PrivateAssetDirectories, sameInode, hasCode} from './private-asset-directories.js';

function safeFile(stat: Stats) {
  if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1) throw Error('PRIVATE_VIDEO_FILE_INVALID');
}
function unchanged(before: Stats, after: Stats) {
  safeFile(after);
  if (!sameInode(before, after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
    throw Error('PRIVATE_VIDEO_FILE_CHANGED');
}
async function checkedOpen(path: string): Promise<FileHandle> {
  const before = await lstat(path); safeFile(before);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {unchanged(before, await file.stat());return file;} catch (error) {await file.close();throw error;}
}
async function digestFile(file: FileHandle, expectedSize: number, signal?: AbortSignal): Promise<string> {
  const before = await file.stat();safeFile(before);
  if (before.size !== expectedSize || expectedSize < 1 || expectedSize > VIDEO_FILE_LIMIT) throw Error('PRIVATE_VIDEO_FILE_INVALID');
  const hash = createHash('sha256'), bytes = Buffer.alloc(65536);let offset = 0;
  while (offset < expectedSize) {
    signal?.throwIfAborted();
    const {bytesRead} = await file.read(bytes, 0, Math.min(bytes.length, expectedSize - offset), offset);
    if (!bytesRead) throw Error('PRIVATE_VIDEO_FILE_INVALID');
    hash.update(bytes.subarray(0, bytesRead));offset += bytesRead;
  }
  unchanged(before, await file.stat());return hash.digest('hex');
}

async function privateVideoAccess(host: ValidatedHost, owner: {ownerId: string; datasetId: string}, revalidate: () => Promise<void>) {
  parseId(owner.ownerId);parseId(owner.datasetId);
  if (host.manifest.ownerId !== owner.ownerId || host.manifest.datasetId !== owner.datasetId) throw Error('PRIVATE_VIDEO_OWNER_MISMATCH');
  const dirs = await PrivateAssetDirectories.create(host, owner.datasetId, {});
  const check = async () => {await revalidate();await dirs.recheck();};
  const pathFor = (id: string) => join(dirs.datasetPath, `${parseId(id)}.mp4`);
  async function openVerified(raw: PrivateVideoMetadata) {
    const metadata = parsePrivateVideoMetadata(raw);await check();
    const path = pathFor(metadata.id), file = await checkedOpen(path);
    try {
      if (await digestFile(file, Number(metadata.byteSize)) !== metadata.sha256) throw Error('PRIVATE_VIDEO_HASH_MISMATCH');
      await check();unchanged(await file.stat(), await lstat(path));
      let closed = false;
      return {metadata, file, close: async () => {if (!closed) {closed = true;await file.close();}}};
    } catch (error) {await file.close();throw error;}
  }
  return {dirs, check, pathFor, openVerified};
}

/** Read-only media access has no downloader/probe dependency and cannot invoke a supplier. */
export async function createPrivateVideoReader(host: ValidatedHost, owner: {ownerId: string; datasetId: string}, revalidate: () => Promise<void>) {
  const access = await privateVideoAccess(host, owner, revalidate);
  return {open: access.openVerified};
}

/** UUID media files are immutable. Recovery manifests are cache hints; only SQLite authorizes playback. */
export async function createPrivateVideoStore(host: ValidatedHost, owner: {ownerId: string; datasetId: string},
  dependencies: {source: VideoDownloadSource; probe: VideoProbe; revalidate(): Promise<void>}): Promise<PrivateVideoStore> {
  const {dirs, check, pathFor, openVerified} = await privateVideoAccess(host, owner, dependencies.revalidate);
  return {
    open: openVerified,
    async materialize(turnId, rawVideo, parentSignal) {
      parseId(turnId);
      const video = parseVideoJobSnapshot({taskId: 'private-video', status: 'succeeded', video: rawVideo}).video!;
      if (video.duration > 120) throw Error('VIDEO_CONTENT_INVALID');
      const sourceHash = createHash('sha256').update(JSON.stringify([turnId, video])).digest('hex');
      const manifestPath = join(dirs.datasetPath, `.video-${turnId}-${sourceHash}.json`);
      const signal = AbortSignal.any([...(parentSignal ? [parentSignal] : []), AbortSignal.timeout(90000)]);
      await check();signal.throwIfAborted();
      // A completed download can survive a crash before the Worker's SQLite update.
      let manifest: FileHandle | undefined;
      try {
        manifest = await checkedOpen(manifestPath);
        const stat = await manifest.stat();if (stat.size < 2 || stat.size > 8192) throw Error('PRIVATE_VIDEO_CACHE_INVALID');
        const bytes = Buffer.alloc(stat.size + 1), read = await manifest.read(bytes, 0, bytes.length, 0);
        unchanged(stat, await manifest.stat());
        if (read.bytesRead !== stat.size) throw Error('PRIVATE_VIDEO_CACHE_INVALID');
        let metadata: PrivateVideoMetadata;
        try {
          const candidate: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, stat.size)));
          fields(candidate, ['schemaVersion', 'turnId', 'sourceHash', 'metadata']);
          if (candidate.schemaVersion !== 1 || candidate.turnId !== turnId || candidate.sourceHash !== sourceHash) throw Error();
          metadata = parsePrivateVideoMetadata(candidate.metadata);
        } catch {throw Error('PRIVATE_VIDEO_CACHE_INVALID');}
        const reader = await openVerified(metadata);
        try {
          const before = await reader.file.stat();
          const measured = await dependencies.probe(reader.file, video, signal);
          if (metadata.duration !== video.duration || Object.entries(measured).some(([key, value]) => metadata[key as keyof PrivateVideoMetadata] !== value)) throw Error('PRIVATE_VIDEO_CACHE_INVALID');
          unchanged(before, await reader.file.stat());unchanged(before, await lstat(pathFor(metadata.id)));
          unchanged(stat, await lstat(manifestPath));
          await check();signal.throwIfAborted();return metadata;
        } finally {await reader.close();}
      } catch (error) {
        // Missing hints mean re-download. Malformed/unsafe hints are not silently replaced.
        if (!hasCode(error, 'ENOENT')) throw error;
      } finally {await manifest?.close();}

      const id = v7(), path = pathFor(id);
      const input = await dependencies.source.open(video.url, signal);
      let metadata: PrivateVideoMetadata;
      try {
      if (input.length !== null && (!Number.isSafeInteger(input.length) || input.length < 1 || input.length > VIDEO_FILE_LIMIT)) throw Error('VIDEO_DOWNLOAD_INVALID');
      await check();signal.throwIfAborted();
      const file = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        safeFile(await file.stat());let size = 0;
        const incomingHash = createHash('sha256');
        for await (const chunk of input.body) {
          signal.throwIfAborted();
          if (!(chunk instanceof Uint8Array) || size + chunk.length > VIDEO_FILE_LIMIT) throw Error('VIDEO_DOWNLOAD_TOO_LARGE');
          incomingHash.update(chunk);
          for (let offset = 0; offset < chunk.length;) {
            const {bytesWritten} = await file.write(chunk, offset, chunk.length - offset, size + offset);
            if (!bytesWritten) throw Error('PRIVATE_VIDEO_WRITE_FAILED');offset += bytesWritten;
          }
          size += chunk.length;
        }
        if (!size || (input.length !== null && size !== input.length)) throw Error('VIDEO_DOWNLOAD_INCOMPLETE');
        signal.throwIfAborted();await file.sync();
        const sha256 = await digestFile(file, size, signal);
        if (sha256 !== incomingHash.digest('hex')) throw Error('PRIVATE_VIDEO_HASH_MISMATCH');
        const stat = await file.stat(), measured = await dependencies.probe(file, video, signal);
        unchanged(stat, await file.stat());await check();unchanged(stat, await lstat(path));
        metadata = parsePrivateVideoMetadata({id, sha256, byteSize: String(size), duration: video.duration, ...measured});
        await dirs.sync('dataset');signal.throwIfAborted();
      } finally {await file.close();}
      } finally {input.close();}
      // Only complete, verified, synced files receive a recovery hint. An interrupted writer never overwrites a media file.
      const temporary = join(dirs.datasetPath, `.${id}.video-cache.tmp`);
      await check();signal.throwIfAborted();
      await writeExclusive(temporary, JSON.stringify({schemaVersion: 1, turnId, sourceHash, metadata}));
      await check();signal.throwIfAborted();await rename(temporary, manifestPath);await dirs.sync('dataset');await check();
      return metadata;
    },
  };
}
