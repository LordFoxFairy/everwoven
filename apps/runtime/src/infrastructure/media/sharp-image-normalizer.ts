import {createHash} from 'node:crypto';
import sharp, {type Sharp} from 'sharp';
import {IMAGE_LIMITS} from '../../contracts/asset.js';
import {parseImageInputMetadata} from '../../contracts/asset-validation.js';
import {ImageNormalizationError, type ImageNormalizer, type NormalizedImage} from '../../ports/image-normalizer.js';
import {inspectImageContainer} from './image-container.js';
import {sharedImageJobBudget as budget} from './image-job-budget.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const checkDeadline = (deadline: number) => {
  if (Date.now() >= deadline) throw new ImageNormalizationError('IMAGE_PROCESSING_TIMEOUT');
};
const nativeTimeout = (deadline: number) => {checkDeadline(deadline); return {seconds: Math.max(1, Math.ceil((deadline - Date.now()) / 1000))};};
function dimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < IMAGE_LIMITS.inputMinEdge || height < IMAGE_LIMITS.inputMinEdge ||
      width > IMAGE_LIMITS.inputMaxEdge || height > IMAGE_LIMITS.inputMaxEdge || width * height > IMAGE_LIMITS.inputPixels) throw new ImageNormalizationError('IMAGE_DIMENSIONS_INVALID');
}
/** Server configuration may shorten, never disable or extend, the ten-second job budget. */
export function createImageNormalizer({timeoutMs = 10_000}: {timeoutMs?: number} = {}): ImageNormalizer {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new ImageNormalizationError('INVALID_IMAGE_INPUT');
  return {normalize: (input, expected) => budget.run(async deadline => {
    if (!(input instanceof Uint8Array)) throw new ImageNormalizationError('INVALID_IMAGE_INPUT');
    if (input.byteLength > IMAGE_LIMITS.inputBytes) throw new ImageNormalizationError('IMAGE_TOO_LARGE');
    let metadata: ReturnType<typeof parseImageInputMetadata>;
    try {metadata = parseImageInputMetadata(expected);} catch {throw new ImageNormalizationError('INVALID_IMAGE_INPUT');}
    // Do not retain a mutable caller buffer (nor the unrelated backing buffer of a sliced view).
    const bytes = Buffer.from(input);
    if (String(bytes.length) !== metadata.inputByteSize) throw new ImageNormalizationError('IMAGE_SIZE_MISMATCH');
    if (sha256(bytes) !== metadata.inputSha256) throw new ImageNormalizationError('IMAGE_HASH_MISMATCH');
    const format = inspectImageContainer(bytes);
    const decoder = sharp(bytes, {failOn: 'warning', limitInputPixels: IMAGE_LIMITS.inputPixels, limitInputChannels: 4, sequentialRead: true});
    let raw: Awaited<ReturnType<typeof decodePixels>>;
    try {
      const info = await decoder.metadata(); checkDeadline(deadline);
      if (info.format !== format) throw new ImageNormalizationError('INVALID_IMAGE_DATA');
      if ((info.pages ?? 1) !== 1 || info.delay || info.loop !== undefined) throw new ImageNormalizationError('IMAGE_ANIMATED');
      dimensions(info.width, info.height);
      raw = await decodePixels(decoder, deadline); checkDeadline(deadline);
      dimensions(raw.info.width, raw.info.height);
      if (raw.info.channels !== 4 || raw.data.length !== raw.info.width * raw.info.height * 4) throw new ImageNormalizationError('INVALID_IMAGE_DATA');
    } finally {decoder.destroy();}
    // Decode every input pixel first. A resize directly from compressed input may skip corrupt
    // pixels via shrink-on-load. This bounded RGBA buffer also discards all source metadata.
    const encoder = sharp(raw.data, {raw: {width: raw.info.width, height: raw.info.height, channels: 4}, limitInputPixels: IMAGE_LIMITS.inputPixels});
    try {
      const output = await encoder.resize({width: IMAGE_LIMITS.outputMaxEdge, height: IMAGE_LIMITS.outputMaxEdge, fit: 'inside', withoutEnlargement: true})
        .webp({quality: 80, alphaQuality: 100, effort: 4, lossless: false, nearLossless: false, smartSubsample: false})
        .timeout(nativeTimeout(deadline)).toBuffer({resolveWithObject: true});
      checkDeadline(deadline);
      if (output.data.length > IMAGE_LIMITS.outputBytes) throw new ImageNormalizationError('IMAGE_OUTPUT_TOO_LARGE');
      if (output.info.format !== 'webp' || output.info.width < 1 || output.info.height < 1 || output.info.width > 2048 || output.info.height > 2048 || output.info.size !== output.data.length) throw new ImageNormalizationError('INVALID_IMAGE_DATA');
      return {bytes: output.data, mimeType: 'image/webp', sha256: sha256(output.data), byteSize: String(output.data.length), width: output.info.width, height: output.info.height} satisfies NormalizedImage;
    } finally {encoder.destroy();}
  }, timeoutMs)};
}
function decodePixels(decoder: Sharp, deadline: number) {
  return decoder.rotate().toColourspace('srgb').ensureAlpha().raw({depth: 'uchar'}).timeout(nativeTimeout(deadline)).toBuffer({resolveWithObject: true});
}
