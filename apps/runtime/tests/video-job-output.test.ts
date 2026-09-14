import {expect, it} from 'vitest';
import {parseVideoJobSnapshot} from '../src/contracts/video-job-output.js';
const good = {taskId: 'task-1', status: 'succeeded', video: {url: 'https://media.example/clip.mp4', ratio: '16:9', resolution: '1080p', duration: 8}};
it('normalizes other suppliers without importing a MiniMax model or resolution enum', () => {
  expect(parseVideoJobSnapshot(good)).toEqual(good);
  expect(parseVideoJobSnapshot({taskId: 'task-1', status: 'running'})).toEqual({taskId: 'task-1', status: 'running'});
  expect(parseVideoJobSnapshot(good).usage).toBeUndefined();
});
it('rejects missing media, early media, credentials, malformed meters and unknown fields', () => {
  for (const raw of [{taskId: 't', status: 'succeeded'}, {...good, status: 'running'}, {...good, rawProviderBody: 'secret'},
    {...good, video: {...good.video, url: 'https://user:secret@media.example/video'}}, {...good, video: {...good.video, duration: Infinity}},
    {...good, usage: {total_tokens: 0.5}}, {...good, usage: {total_seconds: -1}}, {...good, usage: {providerRaw: 1}}])
    expect(() => parseVideoJobSnapshot(raw)).toThrow('INVALID_VIDEO_JOB_RESULT');
});
