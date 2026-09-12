import {createHash} from 'node:crypto';
import type {ReadableStreamReadResult} from 'node:stream/web';
import {parseImageInputMetadata} from '../../contracts/asset-validation.js';
import {ImageBodyError, type ImageBodyErrorCode, type ImageBodyReceiver} from '../../ports/image-body-receiver.js';

let active = 0;
const codes = new Set<ImageBodyErrorCode>(['IMAGE_BODY_INVALID_INPUT', 'IMAGE_BODY_BUSY', 'IMAGE_BODY_ABORTED',
  'IMAGE_BODY_TIMEOUT', 'IMAGE_BODY_TOO_LARGE', 'IMAGE_BODY_SIZE_MISMATCH', 'IMAGE_BODY_HASH_MISMATCH',
  'IMAGE_BODY_READ_FAILED']);
function receiveError(error: unknown): ImageBodyError {
  return new ImageBodyError(error instanceof ImageBodyError && codes.has(error.code) ? error.code : 'IMAGE_BODY_READ_FAILED');
}
function acquire(): () => void {
  if (active >= 2) throw new ImageBodyError('IMAGE_BODY_BUSY');
  active++;
  let released = false;
  // This closure has no receiver/body/work references, including on a stuck cancel.
  return () => {if (!released) {released = true; active--;}};
}
function cancelDetached(reader: ReadableStreamDefaultReader<Uint8Array>, code: ImageBodyErrorCode, release: () => void): void {
  // Never await cancellation on the user's error path. Keep its slot until the real
  // cancellation settles (success OR rejection); a malicious never-settling cancel
  // quarantines one slot, at most two, rather than admitting unbounded pending work.
  // The callback below does not capture any received buffer or application callback.
  try {void Promise.resolve(reader.cancel(code)).then(release, release);} catch {release();}
  try {reader.releaseLock();} catch { /* Preserve the original fixed error. */ }
}

/** Fixed 30s receive budget; server tests may shorten, never extend or disable it.
 * One expected-size allocation (<=10MiB) per admitted receive; no chunk accumulation.
 * Source-owned queued/oversized chunks are outside our allocation bound. HTTP must
 * hand over its existing stream lazily, not prebuffer it or construct a prefetch queue.
 * After delivery, work owns these bytes only until its actual promise settles. */
export function createImageBodyReceiver({timeoutMs = 30_000}: {timeoutMs?: number} = {}): ImageBodyReceiver {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new ImageBodyError('IMAGE_BODY_INVALID_INPUT');
  return {async withBody(source, expected, work) {
    // Admission failures do not call openBody or getReader.
    if (active >= 2) throw new ImageBodyError('IMAGE_BODY_BUSY');
    let metadata: ReturnType<typeof parseImageInputMetadata>;
    try {
      metadata = parseImageInputMetadata(expected);
      if (!source || typeof source.openBody !== 'function' || typeof work !== 'function' ||
          (source.signal !== undefined && !(source.signal instanceof AbortSignal))) throw Error();
    } catch {throw new ImageBodyError('IMAGE_BODY_INVALID_INPUT');}
    const signal = source.signal;
    if (signal?.aborted) throw new ImageBodyError('IMAGE_BODY_ABORTED');
    const release = acquire();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancelOwnsSlot = false, working = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let interruptRead: ((error: ImageBodyError) => void) | undefined;
    const stopReceiving = () => {clearTimeout(timer); interruptRead = undefined; if (onAbort) signal?.removeEventListener('abort', onAbort);};
    try {
      const deadline = Date.now() + timeoutMs;
      let stopped: ImageBodyError | undefined;
      const interrupt = (code: ImageBodyErrorCode) => {
        if (!stopped) {
          stopped = new ImageBodyError(code);
          const pending = interruptRead; interruptRead = undefined; pending?.(stopped);
        }
      };
      onAbort = () => interrupt('IMAGE_BODY_ABORTED');
      signal?.addEventListener('abort', onAbort, {once: true});
      timer = setTimeout(() => interrupt('IMAGE_BODY_TIMEOUT'), timeoutMs);
      const read = () => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        // Only the current read is subscribed. Reusing a pending interruption Promise
        // in Promise.race would retain one reaction per chunk, including empty chunks.
        const unregister = () => {if (interruptRead === fail) interruptRead = undefined;};
        const fail = (error: unknown) => {unregister(); reject(error);};
        interruptRead = fail;
        try {
          // Keep a rejection handler on this read even if interruption already won.
          // Settlement removes the subscription BEFORE resuming the receive loop.
          void reader!.read().then(value => {unregister(); resolve(value);}, fail);
        } catch (error) {fail(error);}
        if (stopped) fail(stopped);
      });
      const check = () => {
        if (stopped) throw stopped;
        if (signal?.aborted) throw new ImageBodyError('IMAGE_BODY_ABORTED');
        // Also bound streams that continuously resolve reads and starve timer delivery.
        if (Date.now() >= deadline) throw new ImageBodyError('IMAGE_BODY_TIMEOUT');
      };
      check();
      const stream = source.openBody();
      if (!(stream instanceof ReadableStream)) throw new ImageBodyError('IMAGE_BODY_READ_FAILED');
      reader = stream.getReader();
      check();
      const size = Number(metadata.inputByteSize), bytes = Buffer.alloc(size), hash = createHash('sha256');
      let offset = 0;
      while (true) {
        check();
        const chunk = await read();
        check();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw new ImageBodyError('IMAGE_BODY_INVALID_INPUT');
        if (chunk.value.byteLength > size - offset) throw new ImageBodyError('IMAGE_BODY_TOO_LARGE');
        bytes.set(chunk.value, offset);
        hash.update(bytes.subarray(offset, offset + chunk.value.byteLength));
        offset += chunk.value.byteLength;
      }
      if (offset !== size) throw new ImageBodyError('IMAGE_BODY_SIZE_MISMATCH');
      if (hash.digest('hex') !== metadata.inputSha256) throw new ImageBodyError('IMAGE_BODY_HASH_MISMATCH');
      check(); stopReceiving(); reader.releaseLock(); reader = undefined;
      working = true;
      return await work(bytes);
    } catch (error) {
      // The internal application/Host owns domain errors; only untrusted reception is sanitized.
      if (working) throw error;
      const safe = receiveError(error);
      stopReceiving();
      if (reader) {cancelOwnsSlot = true; cancelDetached(reader, safe.code, release); reader = undefined;}
      throw safe;
    } finally {
      stopReceiving();
      if (!cancelOwnsSlot) release();
    }
  }};
}
