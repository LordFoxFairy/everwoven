import {expect, it} from 'vitest';
function gate() {let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r;}); return {promise, resolve};}
it('admits only two active reads; abort does not release a still-working slot', async () => {
  const {scheduleAssetRead} = await import('./asset-read-budget'); const a = gate(), b = gate(); let active = 0, max = 0, started = 0;
  const controller = new AbortController();
  const work = async (g?: ReturnType<typeof gate>) => {started++; active++; max = Math.max(max, active); await g?.promise; active--; return new Blob();};
  const first = scheduleAssetRead(() => work(a), controller.signal), second = scheduleAssetRead(() => work(b));
  const third = scheduleAssetRead(() => work()); await Promise.resolve(); expect(started).toBe(2); controller.abort(); await Promise.resolve(); expect(started).toBe(2);
  a.resolve(); b.resolve(); await Promise.allSettled([first, second, third]); expect(max).toBe(2); expect(started).toBe(3);
});
it('queued cancelled reads never start, and the queue is explicitly bounded', async () => {
  const {scheduleAssetRead} = await import('./asset-read-budget'); const hold = gate(); let calls = 0;
  const task = () => {calls++; return hold.promise.then(() => new Blob());};
  const running = [scheduleAssetRead(task), scheduleAssetRead(task)], queued: Promise<Blob>[] = [];
  const abort = new AbortController(); const cancelled = scheduleAssetRead(task, abort.signal); const cancelledCheck = cancelled.catch(error => error); abort.abort();
  for (let i = 0; i < 32; i++) queued.push(scheduleAssetRead(task));
  await expect(scheduleAssetRead(task)).rejects.toMatchObject({failure: {kind: 'busy'}}); expect((await cancelledCheck).name).toBe('AbortError'); expect(calls).toBe(2);
  hold.resolve(); await Promise.all([...running, ...queued]); expect(calls).toBe(34);
});
