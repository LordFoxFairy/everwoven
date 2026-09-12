import {ImageNormalizationError} from '../../ports/image-normalizer.js';

export function publicImageError(error: unknown): ImageNormalizationError {
  if (error instanceof ImageNormalizationError) return error;
  // These are libvips/sharp's fixed diagnostic identifiers, never returned verbatim.
  if (error instanceof Error && /^timeout:/m.test(error.message)) return new ImageNormalizationError('IMAGE_PROCESSING_TIMEOUT');
  if (error instanceof Error && error.message === 'Input image exceeds pixel limit') return new ImageNormalizationError('IMAGE_DIMENSIONS_INVALID');
  return new ImageNormalizationError('INVALID_IMAGE_DATA');
}
/** No queue. Capacity belongs to actual work, not to the lifetime of the caller's promise. */
export class ImageJobBudget {
  private active = 0;
  run<T>(work: (deadline: number) => Promise<T>, timeoutMs: number): Promise<T> {
    if (this.active >= 2) return Promise.reject(new ImageNormalizationError('IMAGE_DECODER_BUSY'));
    this.active++;
    return new Promise<T>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const timer = setTimeout(() => reject(new ImageNormalizationError('IMAGE_PROCESSING_TIMEOUT')), timeoutMs);
      const release = () => {clearTimeout(timer); this.active--;};
      try {
        // Start synchronously, so the normalizer snapshots its caller-owned input before returning.
        work(deadline).then(value => {release(); resolve(value);}, error => {release(); reject(publicImageError(error));});
      } catch (error) {release(); reject(publicImageError(error));}
      // Timeout does NOT call release/destroy or pretend that native processing was cancelled.
      // The sharp pipelines use their native timeout and destroy only after their callback settles.
    });
  }
}

/** One process-wide budget for normalization AND readback verification. Never queue decoders. */
export const sharedImageJobBudget = new ImageJobBudget();
