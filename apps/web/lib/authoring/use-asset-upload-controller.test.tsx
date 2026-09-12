// @vitest-environment jsdom
import {expect, it, vi} from 'vitest';
import {renderHook, act} from '@testing-library/react';
import type {AssetUploadBinding} from './asset-ports';
it('container hook holds one controller across rerenders/tabs, and takes a result once', async () => {
  const {useAssetUploadController} = await import('./use-asset-upload-controller');
  const binding: AssetUploadBinding = {client: {kind: 'demo', read: vi.fn(), importImage: vi.fn(async () => ({kind: 'demo' as const, id: 'browser'}))}, datasetId: null, connected: false, invalidate: vi.fn(), editingKey: 'working-copy'};
  const view = renderHook(({scope, tab: _tab}) => useAssetUploadController(scope), {initialProps: {scope: binding, tab: 1}}), controller = view.result.current.controller;
  await act(async () => {await controller.start(new File(['x'], 'own.png', {type: 'image/png'}), 'rights');});
  view.rerender({scope: {...binding}, tab: 2}); expect(view.result.current.controller).toBe(controller);
  const result = view.result.current.state.result!; let taken; act(() => {taken = controller.takeResult(result.operationId);}); expect(taken).toMatchObject({ref: {kind: 'demo', id: 'browser'}}); expect(controller.takeResult(result.operationId)).toBeNull();
  view.unmount();
});
