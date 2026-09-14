import {spawn} from 'node:child_process';
import type {PrivateVideoReader} from '../../ports/private-video.js';
import {parsePrivateVideoMetadata} from '../../contracts/private-video.js';
import type {SceneFrameEvidence} from '../../application/scene-director.js';

async function frame(reader: PrivateVideoReader, atMs: number, signal: AbortSignal, binary: string): Promise<Uint8Array> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-nostdin', '-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe',
      '-f', 'mov', '-threads', '1', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', '/dev/fd/3', '-ss', (atMs / 1000).toFixed(3),
      '-map', '0:v:0', '-frames:v', '1', '-an', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease',
      '-c:v', 'mjpeg', '-threads', '1', '-q:v', '4', '-f', 'image2pipe', 'pipe:1'],
      {stdio: ['ignore', 'pipe', 'pipe', reader.file.fd], signal, killSignal: 'SIGKILL', windowsHide: true});
    const chunks: Buffer[] = [];let size = 0, invalid = false;
    child.stdout!.on('data', (bytes: Buffer) => {
      if (invalid) return;size += bytes.length;
      if (size > 262144) {invalid = true;child.kill('SIGKILL');return;}chunks.push(bytes);
    });
    child.stderr!.on('data', () => {invalid = true;child.kill('SIGKILL');});
    child.once('error', () => {invalid = true;});
    child.once('close', code => {
      if (invalid || signal.aborted || code !== 0) {reject(Error('GENERATION_FRAME_SAMPLE_FAILED'));return;}
      const bytes = Buffer.concat(chunks);
      if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
        reject(Error('GENERATION_FRAME_SAMPLE_FAILED'));
      else resolve(bytes);
    });
  });
}
/** Consumes and closes an owner-authorized, hash-verified reader; never opens a path or a provider URL. */
export async function samplePrivateVideo(reader: PrivateVideoReader, count: number, parentSignal?: AbortSignal, binary = 'ffmpeg'): Promise<SceneFrameEvidence> {
  try {
    const media = parsePrivateVideoMetadata(reader.metadata);
    if (!Number.isSafeInteger(count) || count < 1 || count > 16 || count > media.durationMs) throw Error('GENERATION_FRAME_EVIDENCE_INVALID');
    const before = await reader.file.stat(), signal = AbortSignal.any([...(parentSignal ? [parentSignal] : []), AbortSignal.timeout(90000)]);
    const frames: SceneFrameEvidence['frames'] = [];
    for (let i = 0; i < count; i++) {
      const atMs = Math.floor(i * Math.min(media.durationMs, media.duration * 1000) / count);
      frames.push({atMs, jpeg: await frame(reader, atMs, signal, binary)});
    }
    const after = await reader.file.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw Error('GENERATION_FRAME_SAMPLE_FAILED');
    return {mediaId: media.id, mediaSha256: media.sha256, frames};
  } finally {await reader.close();}
}
