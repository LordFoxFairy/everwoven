export type ImageInputMetadata = {inputSha256: string; inputByteSize: string};
export type NormalizedImage = {
  bytes: Uint8Array; mimeType: 'image/webp'; sha256: string; byteSize: string; width: number; height: number;
};
export interface ImageNormalizer {
  /** Bytes only. No filename, filesystem path, URL, stream or implicit fetch. */
  normalize(bytes: Uint8Array, expected: ImageInputMetadata): Promise<NormalizedImage>;
}
export type ImageErrorCode = 'INVALID_IMAGE_INPUT' | 'IMAGE_TOO_LARGE' | 'IMAGE_HASH_MISMATCH' | 'IMAGE_SIZE_MISMATCH'
  | 'UNSUPPORTED_IMAGE_FORMAT' | 'INVALID_IMAGE_DATA' | 'IMAGE_DIMENSIONS_INVALID' | 'IMAGE_ANIMATED'
  | 'IMAGE_DECODER_BUSY' | 'IMAGE_PROCESSING_TIMEOUT' | 'IMAGE_OUTPUT_TOO_LARGE';
/** Safe to map to a public error code; intentionally no original error/cause attached. */
export class ImageNormalizationError extends Error {
  constructor(readonly code: ImageErrorCode) {super(code); this.name = 'ImageNormalizationError';}
}
