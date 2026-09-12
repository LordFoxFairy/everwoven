import {createAppClient} from '../../trpc/client';
import {IMAGE_LIMITS} from 'runtime/contracts/asset';
import {parseBeginUpload, parseGetUpload, parseGetAsset, parseCompleteUpload, parseUploadIntentDTO, parseAssetDTO} from 'runtime/contracts/asset-validation';
import type {AssetCommandResult, AssetDTO, UploadIntentDTO} from 'runtime/contracts/asset';
import type {FormalAssetClient} from './asset-ports';
import {ASSET_DATASET_HEADER} from '../../contracts/asset-http';
import {AssetTransportError, assetTransportError, aborted} from './asset-failure';
function input<T>(parse: (value: unknown) => T, value: unknown): T {try {return parse(value);} catch {throw new AssetTransportError('invalid');}}
function output<T>(parse: (value: unknown) => T, value: unknown): T {try {return parse(value);} catch {throw new AssetTransportError('internal');}}
function command<T extends UploadIntentDTO | AssetDTO>(parse: (value: unknown) => T, value: unknown): AssetCommandResult<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || Object.keys(value).some(k => k !== 'data' && k !== 'replayed') || !('data' in value) || !('replayed' in value) || typeof value.replayed !== 'boolean') throw new AssetTransportError('internal');
  return {data: output(parse, value.data), replayed: value.replayed};
}
async function safe<T>(work: () => Promise<T>): Promise<T> {try {return await work();} catch (error) {throw assetTransportError(error);}}
function cancelBody(response: Response): void {
  try {void response.body?.cancel().catch(() => {});} catch { /* Preserve the primary boundary error. */ }
}
async function boundedBytes(response: Response, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit) {cancelBody(response); throw new AssetTransportError('internal');}
  const reader = response.body?.getReader(); if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let size = 0;
  const stop = () => {try {void reader.cancel().catch(() => {});} catch { /* Original failure wins. */ }};
  signal?.addEventListener('abort', stop, {once: true});
  try {
    while (true) {
      if (signal?.aborted) throw aborted();
      const {done, value} = await reader.read(); if (signal?.aborted) throw aborted(); if (done) break;
      size += value.byteLength; if (size > limit) throw new AssetTransportError('internal'); parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) {bytes.set(part, offset); offset += part.length;} return bytes;
  } catch (error) {stop(); throw error;} finally {signal?.removeEventListener('abort', stop); try {reader.releaseLock();} catch { /* No error replacement. */ }}
}
async function check(response: Response, signal?: AbortSignal): Promise<void> {
  if (response.status === 200) return;
  let detail: unknown;
  try {detail = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 4096, signal)));} catch {detail = null;}
  throw assetTransportError(detail, response.status);
}
export function createFormalAssetClient(): FormalAssetClient {
  const rpc = createAppClient();
  return {
    kind: 'formal',
    beginUpload: value => safe(async () => command(parseUploadIntentDTO, await rpc.assets.beginUpload.mutate(input(parseBeginUpload, value)))),
    getUpload: value => safe(async () => output(parseUploadIntentDTO, await rpc.assets.getUpload.query(input(parseGetUpload, value)))),
    completeUpload: value => safe(async () => command(parseAssetDTO, await rpc.assets.completeUpload.mutate(input(parseCompleteUpload, value)))),
    process: (value, file, signal) => safe(async () => {
      const parsed = input(parseGetUpload, value);
      const response = await fetch(`/api/local-assets/uploads/${parsed.uploadId}`, {method: 'PUT', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: {'x-everwoven-request': '1', [ASSET_DATASET_HEADER]: parsed.datasetId, 'content-type': file.type || 'application/octet-stream'}, body: file, signal});
      await check(response, signal);
      const bytes = await boundedBytes(response, 16384, signal); let json: unknown; try {json = JSON.parse(new TextDecoder().decode(bytes));} catch {throw new AssetTransportError('internal');}
      const result = output(parseUploadIntentDTO, json);
      if (result.datasetId !== parsed.datasetId || result.id !== parsed.uploadId || result.status !== 'published') throw new AssetTransportError('internal'); return result;
    }),
    read: (ref, signal) => safe(async () => {
      if (ref.kind !== 'formal') throw new AssetTransportError('invalid');
      const parsed = input(parseGetAsset, {datasetId: ref.datasetId, assetId: ref.id}); if (signal?.aborted) throw aborted();
      const response = await fetch(`/api/local-assets/${parsed.assetId}?datasetId=${parsed.datasetId}`, {credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal});
      await check(response, signal); if (response.headers.get('content-type')?.trim().toLowerCase() !== 'image/webp') {cancelBody(response); throw new AssetTransportError('internal');}
      const bytes = await boundedBytes(response, IMAGE_LIMITS.outputBytes, signal); if (!bytes.length) throw new AssetTransportError('internal'); return new Blob([bytes as Uint8Array<ArrayBuffer>], {type: 'image/webp'});
    }),
  };
}
