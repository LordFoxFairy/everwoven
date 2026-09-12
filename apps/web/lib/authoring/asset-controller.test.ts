import {beforeEach, afterEach, expect, it, vi} from 'vitest';
import {v7} from 'uuid';
import type {AssetDTO, UploadIntentDTO} from 'runtime/contracts/asset';
import type {FormalAssetClient, AssetUploadBinding} from './asset-ports';
const time = '2026-09-12T00:00:00.000Z';
let Controller: typeof import('./asset-controller').AssetUploadController;
let client: FormalAssetClient, binding: AssetUploadBinding, stored: UploadIntentDTO | null, asset: AssetDTO;
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};}
const file = () => new File(['original raw bytes'], 'own.png', {type: 'image/png'});
beforeEach(async () => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({width: 320, height: 256, close: vi.fn()})));
  Controller = (await import('./asset-controller')).AssetUploadController; stored = null;
  client = {
    kind: 'formal', read: vi.fn(async () => new Blob()),
    beginUpload: vi.fn(async input => {
      stored = {id: v7(), datasetId: input.datasetId, assetId: v7(), inputSha256: input.inputSha256, inputByteSize: input.inputByteSize, originalName: input.originalName, rightsDeclaration: input.rightsDeclaration, status: 'reserved', outputSha256: null, outputByteSize: null, outputWidth: null, outputHeight: null, createdAt: time, updatedAt: time, expiresAt: '2026-09-13T00:00:00.000Z', revision: 1}; return {data: stored, replayed: false};
    }),
    getUpload: vi.fn(async () => stored!),
    process: vi.fn(async () => {stored = {...stored!, status: 'published', outputSha256: 'a'.repeat(64), outputByteSize: '12', outputWidth: 320, outputHeight: 256, revision: 4}; return stored;}),
    completeUpload: vi.fn(async () => {
      asset = {id: stored!.assetId, datasetId: stored!.datasetId, sha256: stored!.outputSha256!, byteSize: stored!.outputByteSize!, width: 320, height: 256, originalName: stored!.originalName, rightsDeclaration: stored!.rightsDeclaration, mimeType: 'image/webp', status: 'ready', deletedAt: null, revision: 1, createdAt: time, updatedAt: time}; stored = {...stored!, status: 'completed'}; return {data: asset, replayed: false};
    }),
  };
  binding = {client, connected: true, datasetId: v7(), editingKey: 'draft-1', invalidate: vi.fn()};
});
afterEach(() => vi.unstubAllGlobals());
it('uploads original file, freezes commands and delivers a ready selection once', async () => {
  const c = new Controller(); c.bind(binding); const original = file(), observed: boolean[] = []; c.subscribe(() => observed.push(c.getSnapshot().busy));
  const promise = c.start(original, 'I have permission'); expect(c.getSnapshot().busy).toBe(true); expect(observed[0]).toBe(true); await promise;
  expect(c.getSnapshot()).toMatchObject({phase: 'ready', busy: false, unknown: false});
  expect(client.process).toHaveBeenCalledWith({datasetId: binding.datasetId, uploadId: stored!.id}, original, expect.any(AbortSignal));
  const input = vi.mocked(client.beginUpload).mock.calls[0]![0]; expect(input).toMatchObject({datasetId: binding.datasetId, inputByteSize: String(original.size), originalName: 'own.png', rightsDeclaration: 'I have permission'}); expect(input.inputSha256).toMatch(/^[0-9a-f]{64}$/);
  const result = c.getSnapshot().result!; expect(c.takeResult(result.operationId)).toEqual({operationId: result.operationId, editingKey: 'draft-1', ref: {kind: 'formal', id: stored!.assetId, datasetId: binding.datasetId}}); expect(c.takeResult(result.operationId)).toBeNull(); expect(c.getSnapshot().result).toBeNull();
});
it('same-frame double start shares one flight and does not replace the original file/declaration', async () => {
  const c = new Controller(); c.bind(binding); const first = c.start(file(), 'first rights'), second = c.start(file(), 'second rights'); expect(second).toBe(first); await first;
  expect(client.beginUpload).toHaveBeenCalledTimes(1); expect(vi.mocked(client.beginUpload).mock.calls[0]![0].rightsDeclaration).toBe('first rights');
});
it('lost begin response replays exactly the original command, then reads current state', async () => {
  let saved: UploadIntentDTO;
  vi.mocked(client.beginUpload).mockImplementation(async () => ({data: saved, replayed: true})).mockImplementationOnce(async input => {saved = {id: v7(), assetId: v7(), ...input, status: 'reserved', outputSha256: null, outputByteSize: null, outputWidth: null, outputHeight: null, createdAt: time, updatedAt: time, expiresAt: '2026-09-13T00:00:00.000Z', revision: 1} as UploadIntentDTO; delete (saved as unknown as Record<string, unknown>).commandId; stored = saved; throw TypeError('lost response');});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot()).toMatchObject({phase: 'unknown', unknownStage: 'begin'}); expect(client.process).not.toHaveBeenCalled();
  await c.confirm(); expect(client.beginUpload).toHaveBeenCalledTimes(2); expect(vi.mocked(client.beginUpload).mock.calls[1]![0]).toEqual(vi.mocked(client.beginUpload).mock.calls[0]![0]); expect(client.getUpload).toHaveBeenCalled(); expect(c.getSnapshot().phase).toBe('ready');
});
it('lost complete response retains complete command; retry does not create another intent or resend bytes', async () => {
  let input: unknown; vi.mocked(client.completeUpload).mockImplementationOnce(async value => {input = value; throw TypeError('lost');}).mockImplementation(async value => {expect(value).toEqual(input); return {data: {id: stored!.assetId, datasetId: stored!.datasetId, sha256: 'a'.repeat(64), byteSize: '12', width: 320, height: 256, originalName: 'own.png', rightsDeclaration: 'rights', mimeType: 'image/webp', status: 'ready', deletedAt: null, revision: 1, createdAt: time, updatedAt: time}, replayed: true};});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot()).toMatchObject({unknown: true, unknownStage: 'complete'}); await c.confirm(); expect(c.getSnapshot().phase).toBe('ready'); expect(client.beginUpload).toHaveBeenCalledTimes(1); expect(client.process).toHaveBeenCalledTimes(1);
});
it('lost PUT response reads published and completes without uploading twice', async () => {
  vi.mocked(client.process).mockImplementation(async () => {stored = {...stored!, status: 'published', outputSha256: 'a'.repeat(64), outputByteSize: '12', outputWidth: 320, outputHeight: 256, revision: 4}; throw TypeError('lost');});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot().unknownStage).toBe('process'); await c.retry(); expect(c.getSnapshot().phase).toBe('ready'); expect(client.process).toHaveBeenCalledTimes(1);
});
it.each([[401, 'LOCAL_SESSION_INVALID'], [403, 'LOCAL_ORIGIN_DENIED'], [412, 'unknown precondition']])('confirmation HTTP %s preserves original unknown and command', async (httpStatus, message) => {
  vi.mocked(client.beginUpload).mockRejectedValue(TypeError('lost'));
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); const input = vi.mocked(client.beginUpload).mock.calls[0]![0];
  vi.mocked(client.beginUpload).mockRejectedValue({message, data: {httpStatus}}); await c.confirm(); expect(c.getSnapshot().unknown).toBe(true); expect(c.reset()).toBe(false); expect(vi.mocked(client.beginUpload).mock.calls[1]![0]).toEqual(input);
});
it('dataset change fences old task immediately and requires explicit discard then new start', async () => {
  vi.mocked(client.beginUpload).mockRejectedValue(TypeError('lost')); const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  c.bind({...binding, datasetId: v7(), invalidate: vi.fn()}); expect(c.getSnapshot().datasetChanged).toBe(true); await c.confirm(); expect(client.beginUpload).toHaveBeenCalledTimes(1); expect(c.getSnapshot().result).toBeNull(); expect(c.discardForDatasetChange()).toBe(true); expect(c.getSnapshot().unknown).toBe(false); expect(client.beginUpload).toHaveBeenCalledTimes(1);
  await c.start(file(), 'new rights'); expect(vi.mocked(client.beginUpload).mock.calls[1]![0].datasetId).not.toBe(binding.datasetId); expect(vi.mocked(client.beginUpload).mock.calls[1]![0].commandId).not.toBe(vi.mocked(client.beginUpload).mock.calls[0]![0].commandId);
});
it('old session completion never selects a result or invalidates the newer session', async () => {
  const gate = deferred<never>(), entered = deferred<void>(); vi.mocked(client.beginUpload).mockImplementation(async () => {entered.resolve(); return gate.promise;});
  const c = new Controller(); c.bind(binding); const old = c.start(file(), 'rights'); await entered.promise;
  const invalidate = vi.fn(); c.bind({...binding, invalidate}); gate.resolve(Promise.reject({message: 'LOCAL_SESSION_INVALID', data: {httpStatus: 401}}) as never); await old;
  expect(c.getSnapshot().result).toBeNull(); expect(invalidate).not.toHaveBeenCalled(); expect(binding.invalidate).not.toHaveBeenCalled(); expect(c.getSnapshot().unknown).toBe(true);
});
it('changing editing instance suppresses an unconsumed result even in the same dataset', async () => {
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); const result = c.getSnapshot().result!; c.bind({...binding, editingKey: 'draft-2'}); expect(c.takeResult(result.operationId)).toBeNull(); expect(c.getSnapshot().result).toBeNull();
});
it.each(['', ' ', 'x'.repeat(2001)])('invalid rights declaration makes zero network calls', async rights => {
  const c = new Controller(); c.bind(binding); await c.start(file(), rights); expect(c.getSnapshot().phase).toBe('rejected'); expect(client.beginUpload).not.toHaveBeenCalled();
});
it('preflight closes bitmap and rejects dimensions before beginning', async () => {
  const close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({width: 255, height: 256, close})));
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(close).toHaveBeenCalledTimes(1); expect(client.beginUpload).not.toHaveBeenCalled(); expect(c.getSnapshot().phase).toBe('rejected');
});
it('formal disconnected never imports into browser storage', async () => {
  const c = new Controller(); c.bind({...binding, connected: false}); await c.start(file(), 'rights'); expect(client.beginUpload).not.toHaveBeenCalled(); expect(c.getSnapshot().error?.kind).toBe('session');
});
it('demo imports through its frontend-owned adapter with no synthetic upload commands', async () => {
  const importer = vi.fn(async () => ({kind: 'demo' as const, id: 'browser-id'})); const c = new Controller(); c.bind({...binding, connected: false, datasetId: null, client: {kind: 'demo', read: vi.fn(), importImage: importer}});
  await c.start(file(), 'rights'); expect(c.getSnapshot().result?.ref).toEqual({kind: 'demo', id: 'browser-id'}); expect(client.beginUpload).not.toHaveBeenCalled();
});
it('demo confirmation after suspend awaits the original import, never imports twice', async () => {
  const gate = deferred<{kind: 'demo'; id: string}>(), importer = vi.fn(() => gate.promise);
  const scope: AssetUploadBinding = {...binding, connected: false, datasetId: null, client: {kind: 'demo', read: vi.fn(), importImage: importer}};
  const c = new Controller(); c.bind(scope); const old = c.start(file(), 'rights'); c.suspend(); c.bind(scope);
  const confirmation = c.confirm(); gate.resolve({kind: 'demo', id: 'only-one'}); await Promise.all([old, confirmation]);
  expect(importer).toHaveBeenCalledTimes(1); expect(c.getSnapshot()).toMatchObject({phase: 'ready', unknown: false, result: {ref: {kind: 'demo', id: 'only-one'}}});
});
it.each(['getUpload', 'process', 'completeUpload'] as const)('late %s success after dataset change cannot advance old work or expose a selection', async method => {
  const gate = deferred<never>(), entered = deferred<void>();
  const original = vi.mocked(client[method]).getMockImplementation()!;
  let response: unknown;
  vi.mocked(client[method]).mockImplementation((async (...args: never[]) => {
    response = await (original as (...args: never[]) => Promise<unknown>)(...args); entered.resolve(); return gate.promise;
  }) as never);
  const c = new Controller(); c.bind(binding); const old = c.start(file(), 'rights'); await entered.promise;
  c.bind({...binding, datasetId: v7(), invalidate: vi.fn()}); const snapshot = c.getSnapshot();
  const calls = [vi.mocked(client.process).mock.calls.length, vi.mocked(client.completeUpload).mock.calls.length];
  gate.resolve(response as never); await old;
  expect(c.getSnapshot()).toEqual(snapshot); expect(c.getSnapshot()).toMatchObject({unknown: true, datasetChanged: true, result: null, busy: false});
  expect([vi.mocked(client.process).mock.calls.length, vi.mocked(client.completeUpload).mock.calls.length]).toEqual(calls);
});
it('preflight finishing after a different editing instance makes zero upload calls', async () => {
  const gate = deferred<ImageBitmap>(), close = vi.fn(); vi.stubGlobal('createImageBitmap', vi.fn(() => gate.promise));
  const c = new Controller(); c.bind(binding); const old = c.start(file(), 'rights'); c.bind({...binding, editingKey: 'other'});
  gate.resolve({width: 256, height: 256, close} as unknown as ImageBitmap); await old;
  expect(close).toHaveBeenCalledTimes(1); expect(client.beginUpload).not.toHaveBeenCalled(); expect(c.getSnapshot()).toMatchObject({phase: 'idle', busy: false, unknown: false, result: null});
});
it('exact DATASET_CHANGED fences immediately and remains blocked before a React bind', async () => {
  vi.mocked(client.beginUpload).mockRejectedValue({message: 'DATASET_CHANGED', data: {httpStatus: 412}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot()).toMatchObject({unknown: true, datasetChanged: true, busy: false});
  await c.confirm(); expect(client.beginUpload).toHaveBeenCalledTimes(1); expect(c.discardForDatasetChange()).toBe(false); expect(binding.invalidate).toHaveBeenCalledTimes(1);
});
it('explicit retry repairs a missing uncompleted candidate through the same intent and original File', async () => {
  let candidateExists = false, processCalls = 0;
  const process = vi.mocked(client.process).getMockImplementation()!;
  const complete = vi.mocked(client.completeUpload).getMockImplementation()!;
  vi.mocked(client.process).mockImplementation(async (...args) => {
    const result = await process(...args);
    candidateExists = ++processCalls > 1; // First published candidate disappeared before complete.
    return result;
  });
  vi.mocked(client.completeUpload).mockImplementation(async (...args) => {
    if (!candidateExists) {
      // Runtime compensation keeps immutable output and finalizing, but releases this lease.
      stored = {...stored!, status: 'finalizing', revision: stored!.revision + 2};
      throw {message: 'PRIVATE_ASSET_NOT_FOUND', data: {httpStatus: 404}};
    }
    return complete(...args);
  });
  const c = new Controller(), original = file(); c.bind(binding); await c.start(original, 'rights');
  expect(c.getSnapshot()).toMatchObject({phase: 'rejected', error: {kind: 'missing'}, result: null});
  const command = vi.mocked(client.completeUpload).mock.calls[0]![0];
  expect(client.process).toHaveBeenCalledTimes(1); // No automatic retransmission after failure.
  await c.retry();
  expect(client.process).toHaveBeenCalledTimes(2);
  expect(client.getUpload).toHaveBeenCalledTimes(2);
  expect(vi.mocked(client.process).mock.calls[1]).toEqual([{datasetId: binding.datasetId, uploadId: stored!.id}, original, expect.any(AbortSignal)]);
  expect(client.beginUpload).toHaveBeenCalledTimes(1);
  expect(vi.mocked(client.completeUpload).mock.calls[1]![0]).toEqual(command);
  expect(c.getSnapshot()).toMatchObject({phase: 'ready', unknown: false, result: {ref: {id: stored!.assetId}}});
});
it('an already completed asset losing its file never triggers candidate retransmission during historical confirmation', async () => {
  const complete = vi.mocked(client.completeUpload).getMockImplementation()!;
  let receipt: Awaited<ReturnType<FormalAssetClient['completeUpload']>>;
  vi.mocked(client.completeUpload).mockImplementationOnce(async (...args) => {
    receipt = await complete(...args); // committed ready Asset + receipt, then file removed and response lost
    throw TypeError('response lost');
  }).mockImplementation(async () => ({...receipt, replayed: true}));
  vi.mocked(client.read).mockRejectedValue({message: 'PRIVATE_ASSET_NOT_FOUND', data: {httpStatus: 404}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  expect(stored!.status).toBe('completed'); await c.confirm();
  expect(client.process).toHaveBeenCalledTimes(1); expect(client.beginUpload).toHaveBeenCalledTimes(1);
  expect(vi.mocked(client.completeUpload).mock.calls[1]![0]).toEqual(vi.mocked(client.completeUpload).mock.calls[0]![0]);
  const ref = c.getSnapshot().result!.ref; expect(ref.kind).toBe('formal');
  await expect(client.read(ref as import('./asset-ports').FormalAssetRef)).rejects.toMatchObject({data: {httpStatus: 404}});
  expect(client.process).toHaveBeenCalledTimes(1); // Missing read requires a new selection, never modifying completed storage.
});
it('expired upload gives an explicit expiry/new-selection instruction instead of generic retry advice', async () => {
  vi.mocked(client.completeUpload).mockRejectedValue({message: 'ASSET_UPLOAD_EXPIRED', data: {httpStatus: 409}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  expect(c.getSnapshot()).toMatchObject({phase: 'rejected', unknown: false});
  expect(c.getSnapshot().error?.message).toMatch(/过期/);
  expect(c.getSnapshot().error?.message).toMatch(/重新选择/);
});
it('retry on a terminal expired upload makes zero additional requests and allows explicit new selection', async () => {
  vi.mocked(client.completeUpload).mockRejectedValue({message: 'ASSET_UPLOAD_EXPIRED', data: {httpStatus: 409}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); await c.retry();
  expect(client.completeUpload).toHaveBeenCalledTimes(1); expect(client.process).toHaveBeenCalledTimes(1); expect(client.beginUpload).toHaveBeenCalledTimes(1);
  expect(c.reset()).toBe(true); expect(c.getSnapshot().phase).toBe('idle');
});
it('missing candidate recovery reads completed and only confirms the original complete command', async () => {
  const complete = vi.mocked(client.completeUpload).getMockImplementation()!;
  vi.mocked(client.completeUpload).mockRejectedValueOnce({message: 'PRIVATE_ASSET_NOT_FOUND', data: {httpStatus: 404}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  const command = vi.mocked(client.completeUpload).mock.calls[0]![0];
  const receipt = await complete(command); vi.mocked(client.completeUpload).mockResolvedValue({...receipt, replayed: true});
  await c.retry(); expect(client.getUpload).toHaveBeenCalledTimes(2); expect(client.process).toHaveBeenCalledTimes(1);
  expect(vi.mocked(client.completeUpload).mock.calls[1]![0]).toEqual(command); expect(c.getSnapshot().phase).toBe('ready');
});
it.each(['NOT_FOUND', 'ASSET_UPLOAD_NOT_FOUND', 'PRIVATE_ASSET_NOT_FOUND arbitrary body'])('complete error %s is not permission to retransmit', async message => {
  vi.mocked(client.completeUpload).mockRejectedValue({message, data: {httpStatus: 404}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); await c.retry();
  expect(client.process).toHaveBeenCalledTimes(1); expect(client.beginUpload).toHaveBeenCalledTimes(1); expect(c.getSnapshot().result).toBeNull();
});
it('missing upload during candidate recovery does not retransmit or recreate an intent', async () => {
  vi.mocked(client.completeUpload).mockRejectedValue({message: 'PRIVATE_ASSET_NOT_FOUND', data: {httpStatus: 404}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  vi.mocked(client.getUpload).mockRejectedValue({message: 'ASSET_UPLOAD_NOT_FOUND', data: {httpStatus: 404}});
  await c.retry(); expect(client.getUpload).toHaveBeenCalledTimes(2); expect(client.process).toHaveBeenCalledTimes(1); expect(client.completeUpload).toHaveBeenCalledTimes(1); expect(client.beginUpload).toHaveBeenCalledTimes(1);
});
it('recovery respects the server finalizing lease and explicitly retries the original operation later', async () => {
  const process = vi.mocked(client.process).getMockImplementation()!, complete = vi.mocked(client.completeUpload).getMockImplementation()!;
  vi.mocked(client.completeUpload).mockRejectedValueOnce({message: 'PRIVATE_ASSET_NOT_FOUND', data: {httpStatus: 404}}).mockImplementation(complete);
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); stored = {...stored!, status: 'finalizing'};
  vi.mocked(client.process).mockRejectedValueOnce({message: 'ASSET_UPLOAD_BUSY', data: {httpStatus: 409}}).mockImplementation(process);
  await c.retry(); expect(c.getSnapshot()).toMatchObject({unknown: true, result: null}); expect(c.getSnapshot().error?.message).toMatch(/稍后/);
  expect(client.completeUpload).toHaveBeenCalledTimes(1); await c.confirm(); expect(c.getSnapshot().phase).toBe('ready');
  expect(client.process).toHaveBeenCalledTimes(3); expect(client.beginUpload).toHaveBeenCalledTimes(1);
});
it('lost retransmission response reads published before original complete, without another PUT', async () => {
  const process = vi.mocked(client.process).getMockImplementation()!, complete = vi.mocked(client.completeUpload).getMockImplementation()!;
  vi.mocked(client.completeUpload).mockRejectedValueOnce({message: 'PRIVATE_ASSET_NOT_FOUND', data: {httpStatus: 404}}).mockImplementation(complete);
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  vi.mocked(client.process).mockImplementationOnce(async (...args) => {await process(...args); throw TypeError('retransmission response lost');});
  await c.retry(); expect(c.getSnapshot()).toMatchObject({unknown: true, unknownStage: 'process'});
  await c.confirm(); expect(client.getUpload).toHaveBeenCalledTimes(3); expect(client.process).toHaveBeenCalledTimes(2);
  expect(client.beginUpload).toHaveBeenCalledTimes(1); expect(c.getSnapshot().phase).toBe('ready');
  expect(vi.mocked(client.completeUpload).mock.calls[1]![0]).toEqual(vi.mocked(client.completeUpload).mock.calls[0]![0]);
});
it('candidate recovery read returning after a dataset change makes zero retransmission', async () => {
  vi.mocked(client.completeUpload).mockRejectedValueOnce({message: 'PRIVATE_ASSET_NOT_FOUND', data: {httpStatus: 404}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); const gate = deferred<UploadIntentDTO>();
  vi.mocked(client.getUpload).mockReturnValueOnce(gate.promise); const retry = c.retry();
  expect(client.getUpload).toHaveBeenCalledTimes(2); c.bind({...binding, datasetId: v7()}); gate.resolve(stored!); await retry;
  expect(client.process).toHaveBeenCalledTimes(1); expect(c.getSnapshot()).toMatchObject({datasetChanged: true, result: null});
});
it.each(['beginUpload', 'completeUpload'] as const)('keeps original %s after lost response followed by proxy errors', async method => {
  for (const httpStatus of [400, 404, 413, 415, 412, 500]) {
    // A fresh controller/transport receipt per status; the original write really committed in this fixture.
    const original = vi.mocked(client[method]).getMockImplementation()!; let receipt: unknown;
    vi.mocked(client[method]).mockImplementationOnce((async (...args: never[]) => {
      receipt = await (original as (...args: never[]) => Promise<unknown>)(...args); throw TypeError('committed response lost');
    }) as never).mockRejectedValueOnce({message: '<html>proxy rejected</html>', data: {httpStatus}}).mockImplementationOnce((async () => receipt) as never);
    const c = new Controller(); c.bind(binding); const before = vi.mocked(client[method]).mock.calls.length; await c.start(file(), 'rights');
    expect(c.getSnapshot().unknown).toBe(true); await c.confirm(); expect(c.getSnapshot(), `HTTP ${httpStatus}`).toMatchObject({unknown: true, result: null});
    expect(c.reset()).toBe(false); await c.start(file(), 'replacement'); expect(vi.mocked(client[method]).mock.calls.length).toBe(before + 2);
    await c.confirm(); expect(c.getSnapshot().phase).toBe('ready');
    const calls = vi.mocked(client[method]).mock.calls.slice(before); expect(calls).toHaveLength(3); expect(calls[1]).toEqual(calls[0]); expect(calls[2]).toEqual(calls[0]);
  }
});
it.each([400, 404, 413, 415])('first sent write with a bare HTTP %s retains its command, unlike local validation', async httpStatus => {
  vi.mocked(client.beginUpload).mockRejectedValue({data: {httpStatus}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot().unknown).toBe(true); expect(c.reset()).toBe(false);
});
it.each([{message: 'ASSET_UPLOAD_EXPIRED', data: {httpStatus: 400}}, {message: 'IMAGE_BODY_TOO_LARGE', data: {httpStatus: 404}}, {message: 'IMAGE_BODY_SIZE_MISMATCH', data: {httpStatus: 400, code: 'NOT_FOUND'}}])('mismatched protocol status/code never establishes a definitive failure: %j', async error => {
  vi.mocked(client.beginUpload).mockRejectedValue(error);
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot().unknown).toBe(true); expect(c.reset()).toBe(false);
});
it('getUpload failure after a lost PUT preserves the original pending write even for a valid missing-upload response', async () => {
  const process = vi.mocked(client.process).getMockImplementation()!;
  vi.mocked(client.process).mockImplementationOnce(async (...args) => {await process(...args); throw TypeError('published response lost');});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  vi.mocked(client.getUpload).mockRejectedValueOnce({message: 'ASSET_UPLOAD_NOT_FOUND', data: {httpStatus: 404}});
  await c.confirm(); expect(c.getSnapshot().unknown).toBe(true); expect(c.reset()).toBe(false);
  await c.confirm(); expect(c.getSnapshot().phase).toBe('ready'); expect(client.process).toHaveBeenCalledTimes(1); expect(client.beginUpload).toHaveBeenCalledTimes(1);
});
it.each([[400, 'IMAGE_BODY_HASH_MISMATCH'], [413, 'IMAGE_BODY_TOO_LARGE'], [415, 'UNSUPPORTED_IMAGE_FORMAT']] as const)('valid domain rejection %s/%s remains definitive', async (httpStatus, message) => {
  vi.mocked(client.process).mockRejectedValue({message, data: {httpStatus}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot()).toMatchObject({phase: 'rejected', unknown: false}); expect(c.reset()).toBe(true);
});
it.each(['beginUpload', 'completeUpload'] as const)('retains %s uncertainty across valid pre-receipt parameter rejection and missing-upload responses', async method => {
  const original = vi.mocked(client[method]).getMockImplementation()!; let receipt: unknown;
  vi.mocked(client[method]).mockImplementationOnce((async (...args: never[]) => {
    receipt = await (original as (...args: never[]) => Promise<unknown>)(...args); throw TypeError('committed response lost');
  }) as never).mockRejectedValueOnce({message: 'INVALID_ASSET_COMMAND', data: {httpStatus: 400, code: 'BAD_REQUEST'}})
    .mockRejectedValueOnce({message: 'ASSET_UPLOAD_NOT_FOUND', data: {httpStatus: 404, code: 'NOT_FOUND'}})
    .mockImplementationOnce((async () => receipt) as never);
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  for (let i = 0; i < 2; i++) {
    await c.confirm(); expect(c.getSnapshot()).toMatchObject({unknown: true, result: null}); expect(c.reset()).toBe(false);
    await c.start(file(), 'replacement'); expect(vi.mocked(client[method]).mock.calls.length).toBe(i + 2);
  }
  await c.confirm(); expect(c.getSnapshot().phase).toBe('ready');
  const calls = vi.mocked(client[method]).mock.calls; expect(calls).toHaveLength(4); for (const call of calls) expect(call).toEqual(calls[0]);
  expect(client.process).toHaveBeenCalledTimes(1);
});
it('confirming an uncertain begin clears only begin uncertainty; first PUT domain rejection remains definitive', async () => {
  const begin = vi.mocked(client.beginUpload).getMockImplementation()!; let receipt: Awaited<ReturnType<FormalAssetClient['beginUpload']>>;
  vi.mocked(client.beginUpload).mockImplementationOnce(async input => {receipt = await begin(input); throw TypeError('begin response lost');}).mockImplementationOnce(async () => ({...receipt, replayed: true}));
  vi.mocked(client.process).mockRejectedValue({message: 'IMAGE_BODY_HASH_MISMATCH', data: {httpStatus: 400, code: 'BAD_REQUEST'}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot().unknown).toBe(true);
  await c.confirm(); expect(c.getSnapshot()).toMatchObject({phase: 'rejected', unknown: false}); expect(c.reset()).toBe(true); expect(client.process).toHaveBeenCalledTimes(1);
});
it.each(['beginUpload', 'completeUpload'] as const)('first %s explicit parameter rejection is not an uncertain write', async method => {
  vi.mocked(client[method]).mockRejectedValue({message: 'INVALID_ASSET_COMMAND', data: {httpStatus: 400, code: 'BAD_REQUEST'}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot()).toMatchObject({phase: 'rejected', unknown: false}); expect(c.reset()).toBe(true);
});
it('a same-dataset rebind fences an in-flight begin; its next pre-receipt rejection cannot unlock it', async () => {
  const gate = deferred<Awaited<ReturnType<FormalAssetClient['beginUpload']>>>(), entered = deferred<void>();
  vi.mocked(client.beginUpload).mockImplementationOnce(async () => {entered.resolve(); return gate.promise;}).mockRejectedValueOnce({message: 'INVALID_ASSET_COMMAND', data: {httpStatus: 400, code: 'BAD_REQUEST'}});
  const c = new Controller(); c.bind(binding); const old = c.start(file(), 'rights'); await entered.promise;
  c.bind({...binding, invalidate: vi.fn()}); await c.confirm(); expect(c.getSnapshot().unknown).toBe(true); expect(c.reset()).toBe(false);
  gate.resolve({data: stored!, replayed: true}); await old; expect(c.getSnapshot().unknown).toBe(true);
});
it('begin has no expiry check after receipt lookup, so an expiry-shaped retry cannot resolve a previously unknown begin', async () => {
  vi.mocked(client.beginUpload).mockRejectedValueOnce(TypeError('lost')).mockRejectedValueOnce({message: 'ASSET_UPLOAD_EXPIRED', data: {httpStatus: 409, code: 'CONFLICT'}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); await c.confirm(); expect(c.getSnapshot().unknown).toBe(true); expect(c.reset()).toBe(false);
});
it('complete expiry cannot settle an uncertain original finalizer that might still commit', async () => {
  vi.mocked(client.completeUpload).mockRejectedValueOnce(TypeError('response lost'))
    .mockRejectedValueOnce({message: 'ASSET_UPLOAD_EXPIRED', data: {httpStatus: 409, code: 'CONFLICT'}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights');
  const original = vi.mocked(client.completeUpload).mock.calls[0]![0];
  await c.confirm(); expect(c.getSnapshot()).toMatchObject({phase: 'unknown', unknown: true}); expect(c.reset()).toBe(false);
  await c.confirm(); expect(c.getSnapshot().phase).toBe('ready');
  for (const args of vi.mocked(client.completeUpload).mock.calls) expect(args[0]).toEqual(original);
});

it('a published status read settles only PUT uncertainty; first complete parameter refusal can end normally', async () => {
  const process = vi.mocked(client.process).getMockImplementation()!;
  vi.mocked(client.process).mockImplementationOnce(async (...args) => {await process(...args); throw TypeError('published response lost');});
  vi.mocked(client.completeUpload).mockRejectedValue({message: 'INVALID_ASSET_COMMAND', data: {httpStatus: 400, code: 'BAD_REQUEST'}});
  const c = new Controller(); c.bind(binding); await c.start(file(), 'rights'); expect(c.getSnapshot().unknown).toBe(true);
  await c.confirm(); expect(c.getSnapshot()).toMatchObject({phase: 'rejected', unknown: false}); expect(c.reset()).toBe(true);
  expect(client.process).toHaveBeenCalledTimes(1); expect(client.completeUpload).toHaveBeenCalledTimes(1);
});
it('demo fulfillment while suspended is retained for later confirmation without another import', async () => {
  const gate = deferred<{kind: 'demo'; id: string}>(), importer = vi.fn(() => gate.promise);
  const scope: AssetUploadBinding = {...binding, datasetId: null, connected: false, client: {kind: 'demo', read: vi.fn(), importImage: importer}};
  const c = new Controller(); c.bind(scope); const original = c.start(file(), 'rights'); c.suspend();
  gate.resolve({kind: 'demo', id: 'already-stored'}); await original;
  expect(c.getSnapshot().result).toBeNull(); c.bind(scope); await c.confirm();
  expect(importer).toHaveBeenCalledTimes(1); expect(c.getSnapshot()).toMatchObject({phase: 'ready', unknown: false, result: {ref: {kind: 'demo', id: 'already-stored'}}});
});
