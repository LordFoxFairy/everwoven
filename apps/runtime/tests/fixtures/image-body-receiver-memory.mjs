import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createImageBodyReceiver} from '../../src/infrastructure/media/image-body-receiver.ts';

// Run in a separate Node --expose-gc process, outside Vitest's transformation heap.
// HWM=0 and one reusable chunk exclude a producer queue from retained-heap evidence.
assert.equal(typeof global.gc, 'function');
const mode = process.argv[2];
assert(['tiny', 'empty'].includes(mode));
const receiver = createImageBodyReceiver();
const collect = () => {for (let i = 0; i < 3; i++) global.gc(); return process.memoryUsage().heapUsed;};
async function measure(count) {
  const baseline = collect(), abort = new AbortController();
  const chunk = new Uint8Array(mode === 'tiny' ? [1] : []);
  let sent = 0, atPendingRead;
  const waiting = new Promise(resolve => {atPendingRead = resolve;});
  const stream = new ReadableStream({
    pull(controller) {
      if (sent < count) {sent++; controller.enqueue(chunk);}
      else atPendingRead(); // Deliberately leave the next read pending, before cleanup.
    },
  }, {highWaterMark: 0});
  const expectedSize = mode === 'tiny' ? count + 1 : 1;
  const expected = {inputByteSize: String(expectedSize), inputSha256: createHash('sha256').update(Buffer.alloc(expectedSize, 1)).digest('hex')};
  let workCalls = 0;
  const pending = receiver.withBody({openBody: () => stream, signal: abort.signal}, expected, async () => {workCalls++;}).catch(error => error);
  await waiting;
  await new Promise(resolve => setImmediate(resolve));
  const retainedHeap = collect() - baseline;
  assert.equal(sent, count); assert.equal(stream.locked, true); assert.equal(workCalls, 0);
  abort.abort();
  assert.equal((await pending).code, 'IMAGE_BODY_ABORTED');
  assert.equal(stream.locked, false);
  await new Promise(resolve => setImmediate(resolve));
  return {count, retainedHeap};
}
await measure(1_000); // Warm module/stream machinery before the measured comparison.
const small = await measure(100_000), large = await measure(200_000);
console.log(JSON.stringify({mode, small, large, growth: large.retainedHeap - small.retainedHeap}));
