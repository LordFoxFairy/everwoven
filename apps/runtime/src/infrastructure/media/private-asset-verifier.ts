import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {IMAGE_LIMITS} from '../../contracts/asset.js';
import {ImageNormalizationError} from '../../ports/image-normalizer.js';
import type {PrivateAssetMetadata, VerifiedCandidate} from '../../ports/private-asset-store.js';
import {inspectImageContainer} from './image-container.js';
import {sharedImageJobBudget} from './image-job-budget.js';

export function parseCandidateMetadata(value: unknown): PrivateAssetMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ImageNormalizationError('INVALID_IMAGE_INPUT');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 5 || !['mimeType', 'sha256', 'byteSize', 'width', 'height'].every(key => Object.hasOwn(v, key)) ||
      v.mimeType !== 'image/webp' || typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.sha256) ||
      typeof v.byteSize !== 'string' || !/^[1-9][0-9]{0,7}$/.test(v.byteSize) || Number(v.byteSize) > IMAGE_LIMITS.outputBytes ||
      ![v.width, v.height].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= IMAGE_LIMITS.outputMaxEdge)) {
    throw new ImageNormalizationError('INVALID_IMAGE_INPUT');
  }
  return {mimeType: 'image/webp', sha256: v.sha256, byteSize: v.byteSize, width: v.width as number, height: v.height as number};
}
/** Verify a canonical output without a second lossy encode or input-minimum-edge restriction. */
export function verifyNormalizedImage(input: Uint8Array, expected: PrivateAssetMetadata): Promise<VerifiedCandidate> {
  return sharedImageJobBudget.run(async deadline => {
    const metadata = parseCandidateMetadata(expected);
    if (!(input instanceof Uint8Array)) throw new ImageNormalizationError('INVALID_IMAGE_INPUT');
    if (input.byteLength > IMAGE_LIMITS.outputBytes) throw new ImageNormalizationError('IMAGE_OUTPUT_TOO_LARGE');
    const bytes = Buffer.from(input);
    if (String(bytes.length) !== metadata.byteSize) throw new ImageNormalizationError('IMAGE_SIZE_MISMATCH');
    if (createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) throw new ImageNormalizationError('IMAGE_HASH_MISMATCH');
    if (inspectImageContainer(bytes) !== 'webp') throw new ImageNormalizationError('UNSUPPORTED_IMAGE_FORMAT');
    const checkDeadline = () => {if (Date.now() >= deadline) throw new ImageNormalizationError('IMAGE_PROCESSING_TIMEOUT');};
    const decoder = sharp(bytes, {failOn: 'warning', limitInputPixels: IMAGE_LIMITS.outputMaxEdge ** 2, limitInputChannels: 4, sequentialRead: true});
    try {
      const info = await decoder.metadata(); checkDeadline();
      if (info.format !== 'webp' || (info.pages ?? 1) !== 1 || info.delay || info.loop !== undefined ||
          info.exif || info.icc || info.iptc || info.xmp || info.orientation !== undefined) throw new ImageNormalizationError('INVALID_IMAGE_DATA');
      if (info.width !== metadata.width || info.height !== metadata.height) throw new ImageNormalizationError('IMAGE_DIMENSIONS_INVALID');
      const raw = await decoder.ensureAlpha().raw({depth: 'uchar'})
        .timeout({seconds: Math.max(1, Math.ceil((deadline - Date.now()) / 1000))}).toBuffer({resolveWithObject: true});
      checkDeadline();
      if (raw.info.width !== metadata.width || raw.info.height !== metadata.height || raw.info.channels !== 4 ||
          raw.data.length !== metadata.width * metadata.height * 4) throw new ImageNormalizationError('INVALID_IMAGE_DATA');
      return {bytes, metadata};
    } finally {
      // Native work has really settled; caller timeout alone never frees a decoder slot.
      decoder.destroy();
    }
  }, 10_000);
}
