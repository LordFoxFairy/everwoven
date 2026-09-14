import type {PrivateVideoReader} from 'runtime/host';

const securityHeaders = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin'};
export function videoError(status: number, message: string, method: string, extra: Record<string, string> = {}): Response {
  return new Response(method === 'HEAD' ? null : JSON.stringify({error: message}), {status,
    headers: {...securityHeaders, 'Content-Type': 'application/json', ...extra}});
}
function byteRange(value: string, size: number): {start: number; end: number} | null {
  if (value.length > 96) return null;
  const match = /^bytes=([0-9]*)-([0-9]*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null, last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) return last && last > 0 ? {start: Math.max(0, size - last), end: size - 1} : null;
  if (first >= size || (last !== null && last < first)) return null;
  return {start: first, end: last === null ? size - 1 : Math.min(last, size - 1)};
}

/** Owns the already-verified FD, including HEAD/416, stream end, cancel, timeout and request abort. */
export async function privateVideoResponse(request: Request, reader: PrivateVideoReader): Promise<Response> {
  const size = Number(reader.metadata.byteSize), etag = `"${reader.metadata.sha256}"`;
  const headers: Record<string, string> = {...securityHeaders, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ETag: etag};
  let range = {start: 0, end: size - 1}, status = 200;
  const value = request.method === 'GET' ? request.headers.get('range') : null;
  if (value !== null && (!request.headers.has('if-range') || request.headers.get('if-range') === etag)) {
    const parsed = byteRange(value, size);
    if (!parsed) {await reader.close();return videoError(416, 'VIDEO_RANGE_UNSATISFIABLE', request.method, {'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes'});}
    range = parsed;status = 206;headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  }
  headers['Content-Length'] = String(range.end - range.start + 1);
  if (request.method === 'HEAD') {await reader.close();return new Response(null, {status, headers});}
  if (request.signal.aborted) {await reader.close();return videoError(499, 'VIDEO_READ_CANCELLED', request.method);}
  let offset = range.start, done = false, timer: ReturnType<typeof setTimeout> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const close = async () => {
    if (done) return;done = true;clearTimeout(timer);request.signal.removeEventListener('abort', abort);await reader.close();
  };
  const abort = () => {
    if (done) return;controller.error(Error('VIDEO_READ_CANCELLED'));void close().catch(() => {});
  };
  try {
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;request.signal.addEventListener('abort', abort, {once: true});
        timer = setTimeout(abort, 120000);timer.unref?.();
        if (request.signal.aborted) abort();
      },
      async pull(stream) {
        if (done) return;
        try {
          const bytes = new Uint8Array(Math.min(65536, range.end - offset + 1));
          const {bytesRead} = await reader.file.read(bytes, 0, bytes.length, offset);
          if (done) return;
          if (!bytesRead) throw Error('VIDEO_READ_FAILED');
          offset += bytesRead;stream.enqueue(bytes.subarray(0, bytesRead));
          if (offset > range.end) {await close();stream.close();}
        } catch {
          if (!done) {stream.error(Error('VIDEO_READ_FAILED'));await close();}
        }
      },
      cancel: close,
    });
    return new Response(body, {status, headers});
  } catch (error) {await close();throw error;}
}
