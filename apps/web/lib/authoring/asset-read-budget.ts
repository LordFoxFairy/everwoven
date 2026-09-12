import {aborted, AssetTransportError} from './asset-failure';
const MAX_ACTIVE = 2, MAX_QUEUED = 32;
let active = 0;
type Job = {start(): void; cancel(): void};
const queue: Job[] = [];
/** Cancellation of active work never releases its slot before the real work settles. */
export function scheduleAssetRead(work: () => Promise<Blob>, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) return Promise.reject(aborted());
  if (active >= MAX_ACTIVE && queue.length >= MAX_QUEUED) return Promise.reject(new AssetTransportError('busy'));
  return new Promise((resolve, reject) => {
    const job: Job = {
      cancel() {
        const index = queue.indexOf(job);
        if (index < 0) return;
        queue.splice(index, 1); signal?.removeEventListener('abort', job.cancel); reject(aborted());
      },
      start() {
        signal?.removeEventListener('abort', job.cancel);
        if (signal?.aborted) {reject(aborted()); return;}
        active++;
        let result: Promise<Blob>;
        try {result = work();} catch (error) {result = Promise.reject(error);}
        Promise.resolve(result).then(resolve, reject).finally(() => {
          active--;
          while (active < MAX_ACTIVE && queue.length) queue.shift()!.start();
        });
      },
    };
    if (active < MAX_ACTIVE) job.start();
    else {queue.push(job); signal?.addEventListener('abort', job.cancel, {once: true});}
  });
}
