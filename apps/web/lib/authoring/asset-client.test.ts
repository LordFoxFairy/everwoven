import {beforeEach, afterEach, expect, it, vi} from 'vitest';
import {begin, upload, asset, published, datasetId, assetId, uploadId} from '../../server/fixtures/assets';
const rpc = vi.hoisted(() => ({beginUpload: {mutate: vi.fn()}, getUpload: {query: vi.fn()}, completeUpload: {mutate: vi.fn()}}));
vi.mock('../../trpc/client', () => ({createAppClient: () => ({assets: rpc})}));
let module: typeof import('./asset-client');
beforeEach(async () => {vi.resetAllMocks(); module = await import('./asset-client');});
afterEach(() => vi.unstubAllGlobals());
it('delegates strict tRPC contracts without changing stable commands or historical DTOs', async () => {
  rpc.beginUpload.mutate.mockResolvedValue({data: upload, replayed: true}); rpc.getUpload.query.mockResolvedValue(published); rpc.completeUpload.mutate.mockResolvedValue({data: asset, replayed: true});
  const c = module.createFormalAssetClient(); expect(await c.beginUpload(begin)).toEqual({data: upload, replayed: true}); expect(rpc.beginUpload.mutate).toHaveBeenCalledWith(begin);
  expect(await c.getUpload({datasetId, uploadId})).toEqual(published);
  expect(await c.completeUpload({datasetId, uploadId, commandId: begin.commandId})).toEqual({data: asset, replayed: true});
});
it.each([null, {data: upload, replayed: 'yes'}, {data: {...upload, token: 'private'}, replayed: false}, {data: upload, replayed: false, extra: 1}])('rejects malformed output without body diagnostics', async output => {
  rpc.beginUpload.mutate.mockResolvedValue(output); await expect(module.createFormalAssetClient().beginUpload(begin)).rejects.toMatchObject({failure: {kind: 'internal'}});
});
it('sends original raw File with fixed dataset header, same-origin cookie, no-store and no retries', async () => {
  const fetcher = vi.fn(async () => Response.json(published)); vi.stubGlobal('fetch', fetcher);
  const file = new File(['raw'], 'original.png', {type: 'image/png'}), signal = new AbortController().signal;
  expect(await module.createFormalAssetClient().process({datasetId, uploadId}, file, signal)).toEqual(published);
  expect(fetcher).toHaveBeenCalledTimes(1); const [url, options] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
  expect(url).toBe(`/api/local-assets/uploads/${uploadId}`); expect(options).toMatchObject({method: 'PUT', body: file, credentials: 'same-origin', cache: 'no-store', signal});
  expect(new Headers(options.headers).get('x-everwoven-dataset-id')).toBe(datasetId); expect(new Headers(options.headers).get('x-everwoven-request')).toBe('1');
});
it.each([[401, 'LOCAL_SESSION_INVALID', 'session'], [403, 'LOCAL_ORIGIN_DENIED', 'forbidden'], [412, 'DATASET_CHANGED', 'datasetChanged'], [412, 'other', 'precondition'], [413, 'IMAGE_BODY_TOO_LARGE', 'tooLarge'], [503, 'IMAGE_BODY_BUSY', 'busy'], [500, '/private/raw', 'internal']] as const)('maps HTTP %s/%s without reflecting arbitrary body', async (status, error, kind) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({error}, {status})));
  await expect(module.createFormalAssetClient().process({datasetId, uploadId}, new File(['a'], 'a.png'))).rejects.toMatchObject({failure: {kind}});
});
it('reads private bytes with abort signal and fixed MIME, without tokens in URL', async () => {
  const fetcher = vi.fn(async () => new Response('RIFF', {headers: {'content-type': 'image/webp'}})); vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal, blob = await module.createFormalAssetClient().read({kind: 'formal', id: assetId, datasetId}, signal);
  expect(await blob.text()).toBe('RIFF'); expect(blob.type).toBe('image/webp');
  expect(fetcher).toHaveBeenCalledWith(`/api/local-assets/${assetId}?datasetId=${datasetId}`, expect.objectContaining({signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error'}));
});
it.each(['text/html', 'image/png'])('refuses success with incorrect MIME %s', async mime => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('private', {headers: {'content-type': mime}})));
  await expect(module.createFormalAssetClient().read({kind: 'formal', id: assetId, datasetId})).rejects.toMatchObject({failure: {kind: 'internal'}});
});
it('rejects invalid IDs before any transport call', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(module.createFormalAssetClient().read({kind: 'formal', id: '../private', datasetId})).rejects.toMatchObject({failure: {kind: 'invalid'}}); expect(fetcher).not.toHaveBeenCalled();
});
it.each([{mime: 'text/html'}, {mime: 'image/webp', length: '999999999'}])('cancels rejected response bodies before reading pixels: %j', async ({mime, length}) => {
  const cancel = vi.fn(() => Promise.reject(Error('private cancel failure'))), pull = vi.fn();
  const body = new ReadableStream<Uint8Array>({pull, cancel}, {highWaterMark: 0});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {headers: {'content-type': mime, ...(length ? {'content-length': length} : {})}})));
  await expect(module.createFormalAssetClient().read({kind: 'formal', id: assetId, datasetId})).rejects.toMatchObject({failure: {kind: 'internal'}});
  expect(cancel).toHaveBeenCalledTimes(1); expect(pull).not.toHaveBeenCalled();
});
it('bounds actual bytes even when content-length lies, consumes cancel failure without replacing the error', async () => {
  const cancel = vi.fn(() => Promise.reject(Error('private cancel failure')));
  const body = new ReadableStream<Uint8Array>({pull(c) {c.enqueue(new Uint8Array(11 * 1024 * 1024));}, cancel}, {highWaterMark: 0});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {headers: {'content-type': 'image/webp', 'content-length': '1'}})));
  await expect(module.createFormalAssetClient().read({kind: 'formal', id: assetId, datasetId})).rejects.toMatchObject({failure: {kind: 'internal'}}); expect(cancel).toHaveBeenCalledTimes(1);
});
it('aborting a live response cancels its reader and stops further reads', async () => {
  const cancel = vi.fn(), abort = new AbortController(); let reading!: () => void; const entered = new Promise<void>(r => {reading = r;});
  const body = new ReadableStream<Uint8Array>({pull() {reading();}, cancel}, {highWaterMark: 0});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {headers: {'content-type': 'image/webp'}})));
  const readingResult = module.createFormalAssetClient().read({kind: 'formal', id: assetId, datasetId}, abort.signal).catch(error => error);
  await entered; abort.abort(); const error = await readingResult; expect(error).toMatchObject({failure: {kind: 'network'}}); expect(cancel).toHaveBeenCalledTimes(1);
});
it.each([{error: 'IMAGE_BODY_TOO_LARGE', extra: 'proxy'}, {error: 'ASSET_UPLOAD_EXPIRED'}, {message: 'IMAGE_BODY_TOO_LARGE'}])('HTTP error must have exact protocol shape and status pairing before it can be definitive: %j', async body => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, {status: 413})));
  await expect(module.createFormalAssetClient().process({datasetId, uploadId}, new File(['a'], 'a.png'))).rejects.toMatchObject({identifier: null});
});
