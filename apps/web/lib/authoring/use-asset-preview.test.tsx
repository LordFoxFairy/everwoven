// @vitest-environment jsdom
import {beforeEach, afterEach, expect, it, vi} from 'vitest';
import {renderHook, waitFor, act, cleanup} from '@testing-library/react';
import type {AssetReadBinding, FormalAssetRef} from './asset-ports';
let hook: typeof import('./use-asset-preview').useAssetPreview;
let binding: AssetReadBinding;
const ref: FormalAssetRef = {kind: 'formal', datasetId: '01993ce0-0000-7000-8000-000000000001', id: '01993ce0-0000-7000-8000-000000000002'};
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes;}); return {promise, resolve};}
beforeEach(async () => {
  hook = (await import('./use-asset-preview')).useAssetPreview;
  Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:fixture')}); Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
  binding = {client: {kind: 'formal', read: vi.fn(async () => new Blob(['image'], {type: 'image/webp'})), beginUpload: vi.fn(), getUpload: vi.fn(), process: vi.fn(), completeUpload: vi.fn()}, connected: true, datasetId: ref.datasetId, invalidate: vi.fn()};
});
afterEach(cleanup);
it('creates one URL, ignores equal ref object identity changes and revokes on unmount', async () => {
  const view = renderHook(({value}) => hook(value, binding), {initialProps: {value: ref}});
  await waitFor(() => expect(view.result.current.status).toBe('ready')); expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  view.rerender({value: {...ref}}); expect(binding.client.read).toHaveBeenCalledTimes(1); view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
});
it('dataset/epoch change immediately hides and revokes old URL, without reading the old reference', async () => {
  const view = renderHook(({scope}) => hook(ref, scope), {initialProps: {scope: binding}}); await waitFor(() => expect(view.result.current.status).toBe('ready'));
  view.rerender({scope: {...binding, datasetId: '01993ce0-0000-7000-8000-000000000003', invalidate: vi.fn()}});
  expect(view.result.current.url).toBeNull(); expect(view.result.current.error?.kind).toBe('datasetChanged'); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(binding.client.read).toHaveBeenCalledTimes(1);
});
it('late blob after unmount creates no URL and the read receives an aborted signal', async () => {
  const pending = deferred<Blob>(); vi.mocked(binding.client.read).mockReturnValue(pending.promise);
  const view = renderHook(() => hook(ref, binding)); await waitFor(() => expect(binding.client.read).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(binding.client.read).mock.calls[0]![1]!; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => {pending.resolve(new Blob());}); expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('missing and session failures have distinct states, with explicit read retry', async () => {
  vi.mocked(binding.client.read).mockRejectedValueOnce({message: 'ASSET_NOT_FOUND', data: {httpStatus: 404}});
  const view = renderHook(() => hook(ref, binding)); await waitFor(() => expect(view.result.current.status).toBe('missing'));
  vi.mocked(binding.client.read).mockRejectedValueOnce({message: 'LOCAL_SESSION_INVALID', data: {httpStatus: 401}});
  act(() => view.result.current.retry()); await waitFor(() => expect(view.result.current.status).toBe('disconnected')); expect(binding.invalidate).toHaveBeenCalledTimes(1);
});
it('without binding or while disconnected there is no implicit demo adapter or network', () => {
  const empty = renderHook(() => hook(null, null)); expect(empty.result.current.status).toBe('empty');
  const unavailable = renderHook(() => hook(ref, null)); expect(unavailable.result.current.status).toBe('error');
  const disconnected = renderHook(() => hook(ref, {...binding, connected: false})); expect(disconnected.result.current.status).toBe('disconnected'); expect(binding.client.read).not.toHaveBeenCalled();
});
it('old session failure cannot invalidate a replacement binding', async () => {
  const pending = deferred<Blob>(); vi.mocked(binding.client.read).mockReturnValueOnce(pending.promise);
  const view = renderHook(({scope}) => hook(ref, scope), {initialProps: {scope: binding}}); await waitFor(() => expect(binding.client.read).toHaveBeenCalledTimes(1));
  const invalidate = vi.fn(); view.rerender({scope: {...binding, invalidate}});
  await act(async () => {pending.resolve(Promise.reject({message: 'LOCAL_SESSION_INVALID', data: {httpStatus: 401}}) as never);});
  await waitFor(() => expect(view.result.current.status).toBe('ready')); expect(binding.invalidate).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
});
