import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {withLocalBrowser} from './local-browser-harness.mjs';
import {seedMedia} from './fixtures/generation-media.mjs';
process.env.SMOKE_PORT ??= '3194';

await withLocalBrowser(async ({page, origin, directory, restart}) => {
  await page.goto(origin, {waitUntil: 'networkidle'});
  await page.getByRole('status').filter({hasText: '已连接本机'}).waitFor();
  const {query, hash, size} = await seedMedia(directory), {turnId, ...params} = query;
  const url = `${origin}/api/local-generation-media/${turnId}?${new URLSearchParams(params)}`;
  const play = async () => {
    // This video element exists only in this disposable browser test, not as demo data or a product feature.
    return page.evaluate(async source => {
      const video = document.createElement('video');video.muted = true;video.playsInline = true;video.src = source;document.body.append(video);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Video metadata timeout')), 10000);
          video.onloadedmetadata = () => {clearTimeout(timer);resolve();};video.onerror = () => {clearTimeout(timer);reject(Error('Video decode failed'));};
        });
        video.currentTime = 0.25;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error('Video playback timeout')), 10000);
          video.onended = () => {clearTimeout(timer);resolve();};video.onerror = () => {clearTimeout(timer);reject(Error('Video playback failed'));};
          video.play().catch(error => {clearTimeout(timer);reject(error);});
        });
        return {width: video.videoWidth, height: video.videoHeight, duration: video.duration, ended: video.ended};
      } finally {video.pause();video.removeAttribute('src');video.load();video.remove();}
    }, url);
  };
  assert.deepEqual(await play(), {width: 320, height: 180, duration: 1, ended: true});
  const head = await page.request.head(url);assert.equal(head.status(), 200);assert.equal(head.headers()['content-length'], String(size));
  const partial = await page.request.get(url, {headers: {Range: 'bytes=0-127'}});assert.equal(partial.status(), 206);assert.equal((await partial.body()).length, 128);
  assert.equal((await page.request.get(url, {headers: {Origin: 'https://evil.example'}})).status(), 403);
  await restart();await page.goto(origin, {waitUntil: 'networkidle'});
  await page.getByRole('status').filter({hasText: '已连接本机'}).waitFor();
  assert.deepEqual(await play(), {width: 320, height: 180, duration: 1, ended: true});
  const resumed = await page.request.get(url);assert.equal(resumed.status(), 200);assert.equal(createHash('sha256').update(await resumed.body()).digest('hex'), hash);
  console.log('Private MP4: real browser decode, seek/end, HEAD/Range, original app process restart and immutable hash passed. Local fixture only; zero model calls.');
});
