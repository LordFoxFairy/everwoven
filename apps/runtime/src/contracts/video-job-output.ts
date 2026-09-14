import {fields} from './story-draft-validation.js';
import type {VideoJobSnapshot, GeneratedVideo, VideoUsage} from '../ports/video-jobs.js';
const invalid = () => Error('INVALID_VIDEO_JOB_RESULT');
/** Validate persisted or freshly returned normalized output independently of the vendor protocol. */
export function parseVideoJobSnapshot(raw: unknown): VideoJobSnapshot {
  try {
    fields(raw, ['taskId', 'status'], ['video', 'usage']);
    if (typeof raw.taskId !== 'string' || !raw.taskId || raw.taskId.length > 200 ||
      !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(raw.status as string)) throw invalid();
    let video: GeneratedVideo | undefined;
    if (raw.status === 'succeeded') {
      fields(raw.video, ['url', 'duration', 'resolution', 'ratio']);
      const v = raw.video;
      if (typeof v.url !== 'string' || v.url.length > 8192 || v.url !== v.url.trim()) throw invalid();
      const url = new URL(v.url);
      if (url.protocol !== 'https:' || url.username || url.password ||
        typeof v.duration !== 'number' || !Number.isFinite(v.duration) || v.duration <= 0 ||
        typeof v.resolution !== 'string' || !v.resolution.trim() || v.resolution.length > 64 ||
        typeof v.ratio !== 'string' || !v.ratio.trim() || v.ratio.length > 64) throw invalid();
      video = {url: v.url, duration: v.duration, resolution: v.resolution, ratio: v.ratio};
    } else if (Object.hasOwn(raw, 'video')) throw invalid();
    let usage: VideoUsage | undefined;
    if (Object.hasOwn(raw, 'usage')) {
      const keys = ['output_seconds', 'input_seconds', 'total_seconds', 'input_image_count', 'input_audio_seconds',
        'total_tokens', 'prompt_tokens', 'completion_tokens'] as const;
      fields(raw.usage, [], keys);
      usage = {};
      for (const k of keys) {
        if (!Object.hasOwn(raw.usage, k)) continue;
        const n = raw.usage[k];
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 ||
          (['input_image_count', 'total_tokens', 'prompt_tokens', 'completion_tokens'].includes(k) && !Number.isSafeInteger(n))) throw invalid();
        usage[k] = n;
      }
    }
    return {taskId: raw.taskId, status: raw.status as VideoJobSnapshot['status'], ...(video ? {video} : {}), ...(usage ? {usage} : {})};
  } catch {throw invalid();}
}
