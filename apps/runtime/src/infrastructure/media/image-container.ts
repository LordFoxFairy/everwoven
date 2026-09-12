import {ImageNormalizationError} from '../../ports/image-normalizer.js';
export type InputImageFormat = 'jpeg' | 'png' | 'webp';
const invalid = (): never => {throw new ImageNormalizationError('INVALID_IMAGE_DATA');};
const animated = (): never => {throw new ImageNormalizationError('IMAGE_ANIMATED');};

/** Container framing complements (never substitutes for) a complete pixel decode. */
export function inspectImageContainer(bytes: Buffer): InputImageFormat {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    inspectJpeg(bytes); return 'jpeg';
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let at = 8, first = true;
    while (at + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(at), end = at + 12 + length;
      if (end > bytes.length) invalid();
      const kind = bytes.toString('ascii', at + 4, at + 8);
      if (first && (kind !== 'IHDR' || length !== 13)) invalid();
      first = false;
      if (['acTL', 'fcTL', 'fdAT'].includes(kind)) animated();
      if (kind === 'IEND') {if (length !== 0 || end !== bytes.length) invalid(); return 'png';}
      at = end;
    }
    return invalid();
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) invalid();
    let at = 12;
    while (at + 8 <= bytes.length) {
      const kind = bytes.toString('ascii', at, at + 4), length = bytes.readUInt32LE(at + 4), end = at + 8 + length + (length % 2);
      if (end > bytes.length) invalid();
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && length >= 1 && (bytes[at + 8]! & 2))) animated();
      at = end;
    }
    if (at !== bytes.length) invalid(); return 'webp';
  }
  throw new ImageNormalizationError('UNSUPPORTED_IMAGE_FORMAT');
}
function inspectJpeg(bytes: Buffer): void {
  let at = 2, scan = false;
  while (at < bytes.length) {
    if (scan) {
      // Entropy bytes are arbitrary; only unescaped, non-restart markers end a scan.
      while (at < bytes.length && bytes[at] !== 0xff) at++;
    }
    if (bytes[at++] !== 0xff) invalid();
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === undefined) return invalid();
    if (scan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    scan = false;
    if (marker === 0xd9) {if (at !== bytes.length) invalid(); return;}
    if (marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (marker === 1) continue;
    if (at + 2 > bytes.length) invalid();
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length) invalid();
    if (marker === 0xe2 && bytes.toString('binary', at + 2, at + 6) === 'MPF\0') animated();
    at += length;
    if (marker === 0xda) scan = true;
  }
  invalid();
}
