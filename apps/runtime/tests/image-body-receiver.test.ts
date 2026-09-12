import {afterEach, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const metadata = (bytes: Uint8Array) => ({inputSha256: hash(bytes), inputByteSize: String(bytes.length)});
const bytes = Buffer.from('bounded image bytes');
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
async function subject() {
  const m = await import('../src/infrastructure/media/image-body-receiver.js').catch(() => null);
  expect(m, 'image body receiver must exist').not.toBeNull(); return m!;
}
function source(chunks: unknown[] = [bytes]) {
  let index = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {if (index < chunks.length) controller.enqueue(chunks[index++] as Uint8Array); else controller.close();},
    cancel,
  }, {highWaterMark: 0});
  const getReader = vi.spyOn(stream, 'getReader');
  return {openBody: vi.fn(() => stream), stream, getReader, cancel};
}
function hanging(cancel: () => void | Promise<void> = () => {}) {
  const pulled = deferred<void>();
  const stream = new ReadableStream<Uint8Array>({pull() {pulled.resolve();}, cancel}, {highWaterMark: 0});
  return {openBody: vi.fn(() => stream), stream, pulled};
}

it.each(['tiny', 'empty'])('retained heap stays bounded across 100k/200k %s chunks while the next read is pending', async mode => {
  const runtimeRequire = createRequire(new URL('../package.json', import.meta.url));
  const {stdout} = await promisify(execFile)(process.execPath, ['--expose-gc', '--import', runtimeRequire.resolve('tsx'),
    fileURLToPath(new URL('./fixtures/image-body-receiver-memory.mjs', import.meta.url)), mode], {timeout: 20_000});
  const result = JSON.parse(stdout) as {small: {count: number; retainedHeap: number}; large: {count: number; retainedHeap: number}; growth: number};
  expect(result.small.count).toBe(100_000); expect(result.large.count).toBe(200_000);
  // Allow several MiB of runtime variance, but not one retained reaction per chunk
  // (the old implementation retains ~35/70MiB). Neither assertion relies on elapsed time.
  expect(result.large.retainedHeap, stdout).toBeLessThan(8 * 1024 * 1024);
  expect(result.growth, stdout).toBeLessThan(4 * 1024 * 1024);
});

it('receives real JPEG chunks exactly once, passes isolated bytes and returns the work result', async () => {
  const {createImageBodyReceiver} = await subject();
  const jpeg = await sharp({create: {width: 256, height: 256, channels: 3, background: 'blue'}}).jpeg().toBuffer();
  const input = source([jpeg.subarray(0, 19), jpeg.subarray(19)]), result = {saved: true};
  const work = vi.fn(async (received: Uint8Array) => {expect(received).toEqual(jpeg); expect(received).not.toBe(jpeg); return result;});
  expect(await createImageBodyReceiver().withBody(input, metadata(jpeg), work)).toBe(result);
  expect(input.openBody).toHaveBeenCalledTimes(1); expect(input.getReader).toHaveBeenCalledTimes(1);
  expect(input.stream.locked).toBe(false); expect(input.cancel).not.toHaveBeenCalled(); expect(work).toHaveBeenCalledTimes(1);
});
it.each([0, -1, 30_001, Infinity, 1.5])('rejects invalid receive deadline %s', async timeoutMs => {
  const {createImageBodyReceiver} = await subject(); expect(() => createImageBodyReceiver({timeoutMs})).toThrow('IMAGE_BODY_INVALID_INPUT');
});
it.each([{inputSha256: 'bad', inputByteSize: '1'}, {...metadata(bytes), inputByteSize: '01'}, {...metadata(bytes), inputByteSize: '10485761'}, {...metadata(bytes), path: '/secret'}, null])('invalid metadata never opens the source %#', async expected => {
  const {createImageBodyReceiver} = await subject(), input = source(), work = vi.fn();
  await expect(createImageBodyReceiver().withBody(input, expected as never, work)).rejects.toMatchObject({code: 'IMAGE_BODY_INVALID_INPUT'});
  expect(input.openBody).not.toHaveBeenCalled(); expect(input.getReader).not.toHaveBeenCalled(); expect(work).not.toHaveBeenCalled();
});
it('already-aborted admission does not open or lock a body', async () => {
  const {createImageBodyReceiver} = await subject(), input = source(), abort = new AbortController(); abort.abort('/secret');
  await expect(createImageBodyReceiver().withBody({...input, signal: abort.signal}, metadata(bytes), vi.fn())).rejects.toMatchObject({code: 'IMAGE_BODY_ABORTED', message: 'IMAGE_BODY_ABORTED'});
  expect(input.openBody).not.toHaveBeenCalled(); expect(input.getReader).not.toHaveBeenCalled();
});
it('two module-wide slots cover work across instances; the third is rejected without opening', async () => {
  const {createImageBodyReceiver} = await subject(), a = createImageBodyReceiver(), b = createImageBodyReceiver();
  const gate = deferred<void>(), started = deferred<void>(); let working = 0;
  const work = async () => {if (++working === 2) started.resolve(); await gate.promise; return 'ok';};
  const first = a.withBody(source(), metadata(bytes), work), second = b.withBody(source(), metadata(bytes), work);
  await started.promise; const third = source();
  try {await expect(b.withBody(third, metadata(bytes), vi.fn())).rejects.toMatchObject({code: 'IMAGE_BODY_BUSY'}); expect(third.openBody).not.toHaveBeenCalled(); expect(third.getReader).not.toHaveBeenCalled();}
  finally {gate.resolve(); await Promise.all([first, second]);}
  expect(await a.withBody(source(), metadata(bytes), async () => 7)).toBe(7);
});
it.each([[], [bytes.subarray(1)]].map(chunks => ({chunks})))('rejects empty/short actual body before work %#', async ({chunks}) => {
  const {createImageBodyReceiver} = await subject(), input = source(chunks), work = vi.fn();
  await expect(createImageBodyReceiver().withBody(input, metadata(bytes), work)).rejects.toMatchObject({code: 'IMAGE_BODY_SIZE_MISMATCH'});
  expect(work).not.toHaveBeenCalled(); expect(input.stream.locked).toBe(false);
});
it.each([[bytes, Buffer.from('extra')], [Buffer.alloc(10 * 1024 * 1024 + 1)]].map(chunks => ({chunks})))('counts actual chunks and rejects excess without calling work %#', async ({chunks}) => {
  const {createImageBodyReceiver} = await subject(), input = source(chunks), work = vi.fn();
  await expect(createImageBodyReceiver().withBody(input, metadata(bytes), work)).rejects.toMatchObject({code: 'IMAGE_BODY_TOO_LARGE'});
  expect(work).not.toHaveBeenCalled(); expect(input.cancel).toHaveBeenCalledTimes(1); expect(input.stream.locked).toBe(false);
});
it('accepts the exact ten MiB boundary without a Content-Length dependency', async () => {
  const {createImageBodyReceiver} = await subject(), full = Buffer.alloc(10 * 1024 * 1024, 5);
  expect(await createImageBodyReceiver().withBody(source([full]), metadata(full), async value => value.length)).toBe(full.length);
});
it.each(['text', new ArrayBuffer(2), null, new Uint16Array(3)])('rejects non-byte chunks %#', async chunk => {
  const {createImageBodyReceiver} = await subject(), input = source([chunk]), work = vi.fn();
  await expect(createImageBodyReceiver().withBody(input, metadata(bytes), work)).rejects.toMatchObject({code: 'IMAGE_BODY_INVALID_INPUT'});
  expect(work).not.toHaveBeenCalled(); expect(input.stream.locked).toBe(false);
});
it('rejects a false hash without exposing bytes or running work', async () => {
  const {createImageBodyReceiver} = await subject(), work = vi.fn();
  await expect(createImageBodyReceiver().withBody(source(), {...metadata(bytes), inputSha256: 'a'.repeat(64)}, work)).rejects.toMatchObject({code: 'IMAGE_BODY_HASH_MISMATCH', message: 'IMAGE_BODY_HASH_MISMATCH'});
  expect(work).not.toHaveBeenCalled();
});
it.each(['null', 'throws', 'locked', 'read-rejects'])('sanitizes source failure %s and releases capacity', async mode => {
  const {createImageBodyReceiver} = await subject(), receiver = createImageBodyReceiver();
  const stream = new ReadableStream<Uint8Array>({pull() {throw Error('/private/body');}}, {highWaterMark: 0});
  const lock = mode === 'locked' ? stream.getReader() : undefined;
  const input = {openBody: () => {if (mode === 'throws') throw Error('/private/path'); return mode === 'null' ? null : stream;}};
  try {await expect(receiver.withBody(input, metadata(bytes), vi.fn())).rejects.toMatchObject({code: 'IMAGE_BODY_READ_FAILED', message: 'IMAGE_BODY_READ_FAILED'});}
  finally {lock?.releaseLock();}
  expect(await receiver.withBody(source(), metadata(bytes), async () => true)).toBe(true);
});
it('abort interrupts a pending read; cancel rejection does not replace the safe error', async () => {
  const {createImageBodyReceiver} = await subject(), cancel = vi.fn(async () => {throw Error('/private/cancel');}), input = hanging(cancel), abort = new AbortController();
  const result = createImageBodyReceiver().withBody({...input, signal: abort.signal}, metadata(bytes), vi.fn()).catch(error => error);
  await input.pulled.promise; abort.abort('/private/reason');
  expect(await result).toMatchObject({code: 'IMAGE_BODY_ABORTED', message: 'IMAGE_BODY_ABORTED'});
  expect(cancel).toHaveBeenCalledTimes(1); expect(input.stream.locked).toBe(false);
});
it.each([undefined, 5])('receive deadline %s interrupts pending read, cancels and unlocks', async timeoutMs => {
  const {createImageBodyReceiver} = await subject(); vi.useFakeTimers();
  const cancel = vi.fn(), input = hanging(cancel), work = vi.fn();
  const result = createImageBodyReceiver({timeoutMs}).withBody(input, metadata(bytes), work).catch(error => error);
  await input.pulled.promise; await vi.advanceTimersByTimeAsync(timeoutMs ?? 30_000);
  expect(await result).toMatchObject({code: 'IMAGE_BODY_TIMEOUT', message: 'IMAGE_BODY_TIMEOUT'});
  expect(cancel).toHaveBeenCalledTimes(1); expect(input.stream.locked).toBe(false); expect(work).not.toHaveBeenCalled();
});
it('receive timer and abort listener are cleared before work; work retains capacity until actual settlement', async () => {
  const {createImageBodyReceiver} = await subject(); vi.useFakeTimers();
  const receiver = createImageBodyReceiver({timeoutMs: 5}), gate = deferred<void>(), started = deferred<void>(), abort = new AbortController();
  const remove = vi.spyOn(abort.signal, 'removeEventListener');
  const result = receiver.withBody({...source(), signal: abort.signal}, metadata(bytes), async () => {started.resolve(); await gate.promise; return 9;});
  await started.promise; expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalled();
  abort.abort(); await vi.advanceTimersByTimeAsync(100); gate.resolve(); expect(await result).toBe(9);
});
it.each(['throw', 'reject'])('preserves the trusted work error object on %s and releases both slots', async mode => {
  const {createImageBodyReceiver} = await subject(), receiver = createImageBodyReceiver();
  const domainError = Object.assign(Error('DATASET_CHANGED'), {code: 'DATASET_CHANGED'});
  const work = () => {if (mode === 'throw') throw domainError; return Promise.reject(domainError);};
  await expect(receiver.withBody(source(), metadata(bytes), work)).rejects.toBe(domainError);
  expect(await Promise.all([receiver.withBody(source(), metadata(bytes), async () => 1), receiver.withBody(source(), metadata(bytes), async () => 2)])).toEqual([1, 2]);
});
it('observes late source rejection after abort without leaking the original rejection', async () => {
  const {createImageBodyReceiver} = await subject(), late = deferred<void>(), pulled = deferred<void>(), abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({pull() {pulled.resolve(); return late.promise;}}, {highWaterMark: 0});
  const result = createImageBodyReceiver().withBody({openBody: () => stream, signal: abort.signal}, metadata(bytes), vi.fn()).catch(error => error);
  await pulled.promise; abort.abort(); expect(await result).toMatchObject({code: 'IMAGE_BODY_ABORTED'});
  late.reject(Error('/private/late-read')); await new Promise(resolve => setImmediate(resolve)); expect(stream.locked).toBe(false);
});
it('snapshots expected metadata and copies each received chunk before the next read', async () => {
  const {createImageBodyReceiver} = await subject(), expected = metadata(bytes), original = Buffer.from(bytes), chunk = Buffer.from(bytes); let calls = 0;
  const stream = new ReadableStream<Uint8Array>({pull(controller) {if (!calls++) controller.enqueue(chunk); else {chunk.fill(0); controller.close();}}}, {highWaterMark: 0});
  const pending = createImageBodyReceiver().withBody({openBody: () => stream}, expected, async value => value);
  expected.inputSha256 = '0'.repeat(64); expected.inputByteSize = '1'; expect(await pending).toEqual(original);
});
it.each(['resolve', 'reject'])('quarantined cancellation %s restores capacity only after actual settlement', async mode => {
  const {createImageBodyReceiver} = await subject(), receiver = createImageBodyReceiver(), cancel = deferred<void>(), abort = new AbortController();
  const a = hanging(() => cancel.promise), b = hanging(() => cancel.promise);
  const first = receiver.withBody({...a, signal: abort.signal}, metadata(bytes), vi.fn()).catch(error => error);
  const second = receiver.withBody({...b, signal: abort.signal}, metadata(bytes), vi.fn()).catch(error => error);
  await Promise.all([a.pulled.promise, b.pulled.promise]); abort.abort();
  expect(await first).toMatchObject({code: 'IMAGE_BODY_ABORTED'}); expect(await second).toMatchObject({code: 'IMAGE_BODY_ABORTED'});
  try {await expect(receiver.withBody(source(), metadata(bytes), vi.fn())).rejects.toMatchObject({code: 'IMAGE_BODY_BUSY'});}
  finally {if (mode === 'resolve') cancel.resolve(); else cancel.reject(Error('/private/late-cancel')); await new Promise(resolve => setImmediate(resolve));}
  expect(await Promise.all([receiver.withBody(source(), metadata(bytes), async () => 1), receiver.withBody(source(), metadata(bytes), async () => 2)])).toEqual([1, 2]);
});
it('late work rejection after receive deadline remains observed and releases capacity', async () => {
  const {createImageBodyReceiver} = await subject(); vi.useFakeTimers();
  const gate = deferred<void>(), started = deferred<void>(), receiver = createImageBodyReceiver({timeoutMs: 5}); let calls = 0;
  const work = async () => {if (++calls === 2) started.resolve(); await gate.promise;};
  const first = receiver.withBody(source(), metadata(bytes), work).catch(error => error);
  const second = receiver.withBody(source(), metadata(bytes), work).catch(error => error);
  await started.promise; await vi.advanceTimersByTimeAsync(100);
  const domainError = Object.assign(Error('LEASE_LOST'), {code: 'LEASE_LOST'});
  try {await expect(receiver.withBody(source(), metadata(bytes), vi.fn())).rejects.toMatchObject({code: 'IMAGE_BODY_BUSY'});}
  finally {gate.reject(domainError);}
  expect(await first).toBe(domainError); expect(await second).toBe(domainError);
  expect(await receiver.withBody(source(), metadata(bytes), async () => 1)).toBe(1);
});
it('never-settling cancel rejects users promptly but keeps two quarantine slots, with no unbounded replacement admission', async () => {
  const {createImageBodyReceiver} = await subject(), receiver = createImageBodyReceiver(), abort = new AbortController();
  const a = hanging(() => new Promise<void>(() => {})), b = hanging(() => new Promise<void>(() => {}));
  const first = receiver.withBody({...a, signal: abort.signal}, metadata(bytes), vi.fn()).catch(error => error);
  const second = receiver.withBody({...b, signal: abort.signal}, metadata(bytes), vi.fn()).catch(error => error);
  await Promise.all([a.pulled.promise, b.pulled.promise]); abort.abort();
  try {
    expect(await first).toMatchObject({code: 'IMAGE_BODY_ABORTED'}); expect(await second).toMatchObject({code: 'IMAGE_BODY_ABORTED'});
    expect(a.stream.locked).toBe(false); expect(b.stream.locked).toBe(false);
    for (let i = 0; i < 20; i++) {const input = source(); await expect(createImageBodyReceiver().withBody(input, metadata(bytes), vi.fn())).rejects.toMatchObject({code: 'IMAGE_BODY_BUSY'}); expect(input.openBody).not.toHaveBeenCalled();}
  } finally {vi.resetModules();} // Isolate intentionally poisoned module state from later tests, not a production escape hatch.
});
