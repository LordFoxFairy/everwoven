import type {ImageInputMetadata} from './image-normalizer.js';

/** The caller authenticates and claims the upload BEFORE invoking withBody.
 * openBody must be lazy: constructing a stream may itself prefetch outside this boundary. */
export type ImageBodySource = {
  openBody: () => ReadableStream<Uint8Array> | null;
  signal?: AbortSignal;
};
export interface ImageBodyReceiver {
  /** Two shared slots cover receiving AND actual work settlement, with no queue.
   * Receive cancellation/deadline does not cancel work or a native decoder.
   * Do not retain bytes after work settles. Work is trusted internal composition:
   * its errors propagate unchanged to the application's/Host's error boundary. */
  withBody<T>(source: ImageBodySource, expected: ImageInputMetadata, work: (bytes: Uint8Array) => Promise<T>): Promise<T>;
}
export type ImageBodyErrorCode = 'IMAGE_BODY_INVALID_INPUT' | 'IMAGE_BODY_BUSY' | 'IMAGE_BODY_ABORTED'
  | 'IMAGE_BODY_TIMEOUT' | 'IMAGE_BODY_TOO_LARGE' | 'IMAGE_BODY_SIZE_MISMATCH'
  | 'IMAGE_BODY_HASH_MISMATCH' | 'IMAGE_BODY_READ_FAILED';
/** Fixed identifiers only; never carries the body, abort reason, path or original cause. */
export class ImageBodyError extends Error {
  constructor(readonly code: ImageBodyErrorCode) {super(code); this.name = 'ImageBodyError';}
}
