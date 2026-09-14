import type {FileHandle} from 'node:fs/promises';
import type {GeneratedVideo} from './video-jobs.js';
export const VIDEO_FILE_LIMIT = 128 * 1024 * 1024;
/** These failures need corrected configuration/content; another automatic download cannot authorize them. */
export function isPermanentVideoFailure(error: unknown): boolean {
  return error instanceof Error && new Set([
    'VIDEO_DOWNLOAD_POLICY_UNAVAILABLE', 'VIDEO_DOWNLOAD_SOURCE_DENIED', 'VIDEO_DOWNLOAD_INVALID', 'VIDEO_DOWNLOAD_TOO_LARGE',
    'VIDEO_CONTENT_INVALID', 'VIDEO_DIMENSIONS_UNAVAILABLE', 'VIDEO_PROBE_UNAVAILABLE',
    'PRIVATE_VIDEO_METADATA_INVALID', 'PRIVATE_VIDEO_FILE_INVALID', 'PRIVATE_VIDEO_FILE_CHANGED',
    'PRIVATE_VIDEO_HASH_MISMATCH', 'PRIVATE_VIDEO_CACHE_INVALID', 'PRIVATE_VIDEO_OWNER_MISMATCH',
  ]).has(error.message);
}
export type PrivateVideoMetadata = {
  id: string; sha256: string; byteSize: string; duration: number; durationMs: number;
  width: number; height: number; codec: 'h264'; mimeType: 'video/mp4';
};
export type VideoDownloadSource = {
  open(url: string, signal: AbortSignal): Promise<{body: AsyncIterable<Uint8Array>; length: number | null; close(): void}>;
};
export type VideoProbe = (file: FileHandle, expected: GeneratedVideo, signal: AbortSignal) => Promise<
  Pick<PrivateVideoMetadata, 'width' | 'height' | 'durationMs' | 'codec' | 'mimeType'>>;
export type PrivateVideoReader = {metadata: PrivateVideoMetadata; file: FileHandle; close(): Promise<void>};
export interface PrivateVideoStore {
  materialize(turnId: string, video: GeneratedVideo, signal?: AbortSignal): Promise<PrivateVideoMetadata>;
  /** The caller must first authorize this metadata against its owner-bound SQLite turn. */
  open(metadata: PrivateVideoMetadata): Promise<PrivateVideoReader>;
}
