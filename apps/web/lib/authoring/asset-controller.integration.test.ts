import {beforeAll, afterAll, beforeEach, afterEach, expect, it, vi} from 'vitest';
import {prepare, dispose, fixture, type Fixture} from '../../../runtime/tests/fixtures/asset-service/setup.js';
import type {AssetCommandResult, AssetDTO} from 'runtime/contracts/asset';
import {AssetUploadController} from './asset-controller';
import type {FormalAssetClient} from './asset-ports';
import {assetErrorHTTPStatus, assetErrorTRPCCode} from '../../contracts/asset-http';
let f: Fixture;
beforeAll(prepare, 30000);
afterAll(dispose);
beforeEach(async () => {
  f = await fixture();
  // Client feedback only. The actual service below still decodes the synthetic PNG with sharp.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({width: 320, height: 256, close: vi.fn()})));
});
afterEach(async () => {vi.restoreAllMocks(); vi.unstubAllGlobals(); await f?.close();});
function gate() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};}

it('retains the same complete command across TTL rejection while the original SQLite finalizer can still commit', async () => {
  const verified = gate(), release = gate();
  const ensure = f.files.ensureDurableCandidate.bind(f.files);
  vi.spyOn(f.files, 'ensureDurableCandidate').mockImplementationOnce(async (...args) => {
    const evidence = await ensure(...args); // Real file handle verification + file/parent sync.
    verified.resolve(); await release.promise; return evidence;
  });
  let original: Promise<AssetCommandResult<AssetDTO>> | undefined, calls = 0;
  const client: FormalAssetClient = {
    kind: 'formal',
    beginUpload: vi.fn(input => f.service.begin(input)),
    getUpload: vi.fn(input => f.service.getUpload(input)),
    process: vi.fn((input, file, signal) => f.service.process(input, {openBody: () => file.stream(), signal})),
    read: vi.fn(async ref => {
      const result = await f.service.getBytes({datasetId: ref.datasetId, assetId: ref.id});
      return new Blob([new Uint8Array(result.bytes)], {type: 'image/webp'});
    }),
    completeUpload: vi.fn(async input => {
      if (++calls === 1) {
        f.advance(86400000 - 10);
        original = f.service.complete(input);
        // Simulate a lost connection, not cancellation of the actual server work.
        await Promise.race([verified.promise, original.then(() => {throw Error('fixture finalizer completed before release');})]);
        throw TypeError('fixture lost connection after finalizing claim');
      }
      try {return await f.service.complete(input);} catch (cause) {
        // Use the exact real service error and shared wire pairing, not a fabricated expiry.
        const message = cause instanceof Error ? cause.message : '';
        const httpStatus = assetErrorHTTPStatus(message) ?? 500;
        throw {message, data: {httpStatus, code: assetErrorTRPCCode(httpStatus)}};
      }
    }),
  };
  const controller = new AssetUploadController();
  controller.bind({client, connected: true, datasetId: f.owner.datasetId, invalidate: vi.fn(), editingKey: 'real-sqlite-fixture'});
  try {
    await controller.start(new File([new Uint8Array(f.bytes)], 'generated.png', {type: 'image/png'}), 'fixture own art');
    expect(controller.getSnapshot()).toMatchObject({unknown: true, unknownStage: 'complete'});
    const row = await f.db.assetUpload.findFirstOrThrow();
    expect(row.status).toBe('finalizing'); expect(row.leaseExpiresAt!.getTime() - row.updatedAt.getTime()).toBe(120000);
    expect(await f.db.asset.count()).toBe(0);
    f.advance(20); await controller.confirm(); // TTL + 10ms; same original lease remains valid.
    const rejectedWhileOriginalActive = controller.getSnapshot(), resetAllowed = controller.reset();
    expect(await f.db.asset.count()).toBe(0);
    expect(await f.db.commandReceipt.count({where: {commandType: 'authoring.asset.complete.v1'}})).toBe(0);
    release.resolve(); const ready = await original!;
    expect(ready.data.status).toBe('ready');
    expect(await f.db.asset.count()).toBe(1);
    expect(await f.db.commandReceipt.count({where: {commandType: 'authoring.asset.complete.v1'}})).toBe(1);
    expect(rejectedWhileOriginalActive).toMatchObject({phase: 'unknown', unknown: true, result: null});
    expect(resetAllowed).toBe(false); expect(controller.getSnapshot().result).toBeNull();
    await controller.start(new File([new Uint8Array(f.bytes)], 'replacement.png', {type: 'image/png'}), 'replacement rights');
    expect(client.beginUpload).toHaveBeenCalledTimes(1);
    await controller.confirm();
    const replay = await vi.mocked(client.completeUpload).mock.results[2]!.value; expect(replay.replayed).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({phase: 'ready', unknown: false, result: {ref: {id: ready.data.id, datasetId: f.owner.datasetId}}});
    const commands = vi.mocked(client.completeUpload).mock.calls;
    expect(commands).toHaveLength(3); for (const args of commands) expect(args[0]).toEqual(commands[0]![0]);
    expect(client.beginUpload).toHaveBeenCalledTimes(1); expect(client.process).toHaveBeenCalledTimes(1);
    expect(await f.db.assetUpload.count()).toBe(1);
    expect(await f.db.commandReceipt.count({where: {commandType: 'authoring.asset.complete.v1'}})).toBe(1);
  } finally {release.resolve(); await original?.catch(() => {});}
});
