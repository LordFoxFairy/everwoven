import {fields, parseId} from './story-draft-validation.js';
import {VIDEO_FILE_LIMIT, type PrivateVideoMetadata} from '../ports/private-video.js';
export function parsePrivateVideoMetadata(value: unknown): PrivateVideoMetadata {
  try {
    fields(value, ['id', 'sha256', 'byteSize', 'duration', 'durationMs', 'width', 'height', 'codec', 'mimeType']);
    const id = parseId(value.id);
    if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) ||
      typeof value.byteSize !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value.byteSize) || BigInt(value.byteSize) > BigInt(VIDEO_FILE_LIMIT) ||
      typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 120 ||
      typeof value.durationMs !== 'number' || !Number.isSafeInteger(value.durationMs) || value.durationMs < 1 || value.durationMs > 120250 ||
      Math.abs(value.durationMs / 1000 - value.duration) > 0.25 || value.codec !== 'h264' || value.mimeType !== 'video/mp4') throw Error();
    for (const edge of [value.width, value.height])
      if (typeof edge !== 'number' || !Number.isSafeInteger(edge) || edge < 64 || edge > 8192) throw Error();
    if ((value.width as number) * (value.height as number) > 33554432) throw Error();
    return {id, sha256: value.sha256, byteSize: value.byteSize, duration: value.duration,
      durationMs: value.durationMs, width: value.width as number, height: value.height as number, codec: 'h264', mimeType: 'video/mp4'};
  } catch {throw Error('PRIVATE_VIDEO_METADATA_INVALID');}
}
