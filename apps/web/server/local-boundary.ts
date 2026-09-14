import { isAbsolute } from 'node:path';
export type LocalRuntimeConfig = { directory: string; environment: 'dev' | 'prod'; origin: string };
export function localRuntimeConfig(env: Record<string, string | undefined>): LocalRuntimeConfig | null {
  if (
    env.EVERWOVEN_LOCAL_LAUNCH !== 'loopback-v1' ||
    !['dev', 'prod'].includes(env.APP_ENV ?? '') ||
    !env.RUNTIME_DATA_DIR ||
    !isAbsolute(env.RUNTIME_DATA_DIR)
  )
    return null;
  try {
    const u = new URL(env.APP_ORIGIN ?? '');
    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.hostname !== '127.0.0.1' ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash
    )
      return null;
    return { directory: env.RUNTIME_DATA_DIR, environment: env.APP_ENV as 'dev' | 'prod', origin: u.origin };
  } catch {
    return null;
  }
}
export function guardLocalRequest(request: Request, config: LocalRuntimeConfig): void {
  const expected = new URL(config.origin),
    host = request.headers.get('host'),
    origin = request.headers.get('origin');
  if (
    (host ? host !== expected.host : new URL(request.url).origin !== expected.origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (origin !== null && origin !== expected.origin)
  )
    throw Error('LOCAL_ORIGIN_DENIED');
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    (origin !== expected.origin || request.headers.get('x-everwoven-request') !== '1')
  )
    throw Error('LOCAL_ORIGIN_DENIED');
}
export const sessionCookie = 'everwoven_local';
export function sessionToken(request: Request): string {
  const entries = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.startsWith(sessionCookie + '='));
  if (entries.length !== 1) return '';
  const token = entries[0]!.slice(sessionCookie.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}
/** Consume once and rebuild for the framework; bounded bytes, not only Content-Length. */
export async function boundedJSONRequest(request: Request, limit = 262144): Promise<Request> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    throw Error('JSON_REQUIRED');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > limit) throw Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader)
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw Error('BODY_TOO_LARGE');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
    signal: request.signal,
  });
}
