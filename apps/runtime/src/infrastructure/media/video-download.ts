import {lookup} from 'node:dns/promises';
import type {LookupAddress} from 'node:dns';
import {get} from 'node:https';
import {isIP} from 'node:net';
import {VIDEO_FILE_LIMIT, type VideoDownloadSource} from '../../ports/private-video.js';

export function isPublicVideoIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a! >= 224 ||
    (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
/** Explicit installed CDN hosts only. Pin public IPv4 DNS to the TLS connection; no redirects, proxy or credentials. */
export function createVideoDownloadSource(allowedHosts: readonly string[]): VideoDownloadSource {
  if (!allowedHosts.length || allowedHosts.length > 32 || allowedHosts.some(host => !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(host)))
    throw Error('VIDEO_DOWNLOAD_POLICY_UNAVAILABLE');
  const allowed = new Set(allowedHosts);
  return {async open(raw, signal) {
    let url: URL;
    try {
      if (raw.length > 8192 || raw !== raw.trim()) throw Error();
      url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || !allowed.has(url.hostname)) throw Error();
    } catch {throw Error('VIDEO_DOWNLOAD_SOURCE_DENIED');}
    signal.throwIfAborted();
    let addresses;
    try {
      addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
        const abort = () => {signal.removeEventListener('abort', abort);reject(Error('VIDEO_DOWNLOAD_UNAVAILABLE'));};
        signal.addEventListener('abort', abort, {once: true});
        lookup(url.hostname, {all: true, family: 4}).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) abort();
      });
    } catch {throw Error('VIDEO_DOWNLOAD_UNAVAILABLE');}
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(row => !isPublicVideoIPv4(row.address))) throw Error('VIDEO_DOWNLOAD_SOURCE_DENIED');
    const address = addresses[0]!.address;
    return new Promise((resolve, reject) => {
      const request = get(url, {agent: false, family: 4, signal,
        lookup: (_host, _options, callback) => callback(null, address, 4),
        headers: {Accept: 'video/mp4, application/octet-stream', 'Accept-Encoding': 'identity'}}, response => {
        const type = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        const size = response.headers['content-length'], encoding = response.headers['content-encoding'];
        if (response.statusCode !== 200 || !['video/mp4', 'application/octet-stream'].includes(type ?? '') ||
          (encoding && encoding !== 'identity') || (size !== undefined && (!/^[1-9][0-9]*$/.test(size) || Number(size) > VIDEO_FILE_LIMIT))) {
          response.destroy(); reject(Error('VIDEO_DOWNLOAD_INVALID')); return;
        }
        resolve({body: response, length: size === undefined ? null : Number(size), close: () => response.destroy()});
      });
      request.once('error', () => reject(Error('VIDEO_DOWNLOAD_UNAVAILABLE')));
    });
  }};
}
