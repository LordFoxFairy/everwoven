import {expect, it, vi, afterEach} from 'vitest';
const store = vi.hoisted(() => ({readImageAsset: vi.fn(), importImageAsset: vi.fn()}));
vi.mock('../assets/store', () => store);
afterEach(() => {vi.resetAllMocks(); vi.unstubAllGlobals();});
it('demo owns browser storage and never calls formal transport', async () => {
  const {createDemoAssetClient} = await import('./demo-asset-client'), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const file = new File(['a'], 'a.png'), blob = new Blob(['a']); store.importImageAsset.mockResolvedValue({id: 'browser-id'}); store.readImageAsset.mockResolvedValue({blob});
  const c = createDemoAssetClient(); expect(await c.importImage(file)).toEqual({kind: 'demo', id: 'browser-id'});
  expect(await c.read({kind: 'demo', id: 'browser-id'})).toBe(blob); expect(store.importImageAsset).toHaveBeenCalledWith(file, 'demo'); expect(store.readImageAsset).toHaveBeenCalledWith('browser-id', 'demo'); expect(fetcher).not.toHaveBeenCalled();
});
it('missing demo data is distinct from storage error', async () => {
  const {createDemoAssetClient} = await import('./demo-asset-client'); store.readImageAsset.mockResolvedValue(undefined);
  await expect(createDemoAssetClient().read({kind: 'demo', id: 'missing'})).rejects.toMatchObject({failure: {kind: 'missing'}});
  store.readImageAsset.mockRejectedValue(Error('private database path'));
  await expect(createDemoAssetClient().read({kind: 'demo', id: 'missing'})).rejects.toMatchObject({failure: {kind: 'internal'}});
});
it('controller explicitly retries the original File after a definitive browser transaction failure', async () => {
  const {createDemoAssetClient} = await import('./demo-asset-client');
  const {AssetUploadController} = await import('./asset-controller');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  store.importImageAsset.mockRejectedValueOnce(Error('fixture transaction rollback /private/quota'))
    .mockResolvedValueOnce({id: 'browser-recovered'});
  const file = new File(['original'], 'original.png', {type: 'image/png'}), controller = new AssetUploadController();
  controller.bind({client: createDemoAssetClient(), connected: false, datasetId: null, invalidate: vi.fn(), editingKey: 'demo-draft'});
  await controller.start(file, 'fixture rights');
  expect(controller.getSnapshot()).toMatchObject({phase: 'rejected', unknown: false, busy: false, result: null});
  expect(controller.getSnapshot().error?.message).not.toMatch(/private|quota/);
  expect(store.importImageAsset).toHaveBeenCalledTimes(1); // No automatic retry after rollback.
  await controller.retry();
  expect(store.importImageAsset).toHaveBeenCalledTimes(2);
  expect(store.importImageAsset.mock.calls).toEqual([[file, 'demo'], [file, 'demo']]);
  expect(controller.getSnapshot()).toMatchObject({phase: 'ready', unknown: false, result: {ref: {kind: 'demo', id: 'browser-recovered'}}});
  expect(fetcher).not.toHaveBeenCalled();
});
it('a definitive import rejection arriving after suspend still permits an explicit retry, without auto-import', async () => {
  const {createDemoAssetClient} = await import('./demo-asset-client'), {AssetUploadController} = await import('./asset-controller');
  let fail!: (error: Error) => void; const pending = new Promise<never>((_, reject) => {fail = reject;});
  store.importImageAsset.mockReturnValueOnce(pending).mockResolvedValueOnce({id: 'browser-after-reconnect'});
  const scope = {client: createDemoAssetClient(), connected: false, datasetId: null, invalidate: vi.fn(), editingKey: 'demo-draft'};
  const file = new File(['original'], 'original.png', {type: 'image/png'}), controller = new AssetUploadController(); controller.bind(scope);
  const old = controller.start(file, 'rights'); controller.suspend(); fail(Error('fixture aborted transaction')); await old;
  expect(store.importImageAsset).toHaveBeenCalledTimes(1); controller.bind(scope); await controller.retry();
  expect(store.importImageAsset.mock.calls).toEqual([[file, 'demo'], [file, 'demo']]);
  expect(controller.getSnapshot()).toMatchObject({phase: 'ready', unknown: false, result: {ref: {kind: 'demo', id: 'browser-after-reconnect'}}});
});
