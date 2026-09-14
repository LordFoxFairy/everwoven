import {spawn} from 'node:child_process';
import type {FileHandle} from 'node:fs/promises';
import type {VideoProbe} from '../../ports/private-video.js';
import type {GeneratedVideo} from '../../ports/video-jobs.js';

async function inspect(binary: string, file: FileHandle, signal: AbortSignal, frames: boolean): Promise<unknown> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Inherit the already-verified descriptor. MOV external data references are explicitly disabled.
    const child = spawn(binary, ['-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe',
      '-f', 'mov', '-threads', '1', '-enable_drefs', '0', '-use_absolute_path', '0', ...(frames ? ['-count_frames'] : []),
      '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames,start_time,duration:format=duration,format_name',
      '-of', 'json', '/dev/fd/3'], {stdio: ['ignore', 'pipe', 'pipe', file.fd], signal, killSignal: 'SIGKILL', windowsHide: true});
    let output = '', errorOutput = '', overflow = false, unavailable = false;
    child.stdout!.on('data', chunk => {if (overflow) return;output += String(chunk); if (output.length > 32768) {overflow = true; child.kill('SIGKILL');}});
    child.stderr!.on('data', chunk => {if (overflow) return;errorOutput += String(chunk); if (errorOutput.length > 8192) {overflow = true; child.kill('SIGKILL');}});
    child.once('error', () => {unavailable = true;});
    child.once('close', code => {
      if (unavailable) {reject(Error('VIDEO_PROBE_UNAVAILABLE'));return;}
      if (signal.aborted || code !== 0 || overflow || errorOutput) {reject(Error('VIDEO_CONTENT_INVALID')); return;}
      try {resolve(JSON.parse(output));} catch {reject(Error('VIDEO_CONTENT_INVALID'));}
    });
  });
}
/** V1 playback codec: H.264 MP4 with optional AAC. Both metadata and full decoded frame count are checked. */
export function createVideoProbe(dimensions: (expected: GeneratedVideo) => {width: number; height: number}, binary = 'ffprobe'): VideoProbe {
  return async (file, expected, parentSignal) => {
    // Exact pixels come from the sealed supplier/model specification, never a guessed meaning of "2K" or "768P".
    const target = dimensions(expected);
    if (!target || ![target.width, target.height].every(edge => Number.isSafeInteger(edge) && edge >= 64 && edge <= 8192) ||
      target.width * target.height > 33554432) throw Error('VIDEO_DIMENSIONS_UNAVAILABLE');
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(30000)]);
    let verified: {width: number; height: number; durationMs: number} | undefined;
    for (const frames of [false, true]) {
      const result = await inspect(binary, file, signal, frames) as {streams?: Array<Record<string, unknown>>; format?: {duration?: string}};
      if (!Array.isArray(result.streams) || result.streams.length < 1 || result.streams.length > 2) throw Error('VIDEO_CONTENT_INVALID');
      const videos = result.streams.filter(stream => stream.codec_type === 'video'), audios = result.streams.filter(stream => stream.codec_type === 'audio');
      if (videos.length !== 1 || audios.length > 1 || videos.length + audios.length !== result.streams.length || audios.some(s => s.codec_name !== 'aac')) throw Error('VIDEO_CONTENT_INVALID');
      const video = videos[0]!, width = video.width, height = video.height, seconds = Number(video.duration), containerSeconds = Number(result.format?.duration);
      if (video.codec_name !== 'h264' || typeof width !== 'number' || typeof height !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 64 || height < 64 || width > 8192 || height > 8192 || width * height > 33554432 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 120.25 ||
        Math.abs(seconds - expected.duration) > 0.25 || width !== target.width || height !== target.height ||
        !Number.isFinite(containerSeconds) || Math.abs(containerSeconds - seconds) > 0.25 ||
        !Number.isFinite(Number(video.start_time)) || Math.abs(Number(video.start_time)) > 0.25 ||
        audios.some(audio => !Number.isFinite(Number(audio.duration)) || Math.abs(Number(audio.duration) - seconds) > 0.25 ||
          !Number.isFinite(Number(audio.start_time)) || Math.abs(Number(audio.start_time)) > 0.25)) throw Error('VIDEO_CONTENT_INVALID');
      if (expected.ratio !== 'adaptive') {
        const ratio = /^([1-9][0-9]*):([1-9][0-9]*)$/.exec(expected.ratio);
        if (!ratio || Math.abs(width / height - Number(ratio[1]) / Number(ratio[2])) > 0.03) throw Error('VIDEO_CONTENT_INVALID');
      }
      if (frames && (!Number.isSafeInteger(Number(video.nb_read_frames)) || Number(video.nb_read_frames) < 1 || Number(video.nb_read_frames) > 14400)) throw Error('VIDEO_CONTENT_INVALID');
      const metadata = {width, height, durationMs: Math.round(seconds * 1000)};
      if (verified && JSON.stringify(metadata) !== JSON.stringify(verified)) throw Error('VIDEO_CONTENT_INVALID');
      verified = metadata;
    }
    return {...verified!, codec: 'h264', mimeType: 'video/mp4'};
  };
}
